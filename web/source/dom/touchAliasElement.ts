// References extra HTML definitions not included by default in TS.
/// <reference path="../kmwexthtml.ts" />
// References device-specific code checks (separable module from KMW)
/// <reference path="../kmwdevice.ts" />
// References common DOM utility functions (separate module from KMW)
/// <reference path="utils.ts" />

namespace com.keyman.dom {
  /**
   * As our touch-alias elements have historically been based on <div>s, this
   * defines the root element of touch-aliases as a merger type with HTMLDivElements.
   *
   */
  export type TouchAliasElement = HTMLDivElement & TouchAliasData;

  // Many thanks to https://www.typescriptlang.org/docs/handbook/advanced-types.html for this.
  function link(elem: HTMLDivElement, data: TouchAliasData): TouchAliasElement {
    let e = <TouchAliasElement> elem;

    // Merges all properties and methods of KeyData onto the underlying HTMLDivElement, creating a merged class.
    for(let id in data) {
      if(!e.hasOwnProperty(id)) {
        (<any>e)[id] = (<any>data)[id];
      }
    }

    return e;
  }

  // If the specified HTMLElement is either a TouchAliasElement or one of its children elements,
  // this method will return the root TouchAliasElement.
  export function findTouchAliasTarget(target: HTMLElement): TouchAliasElement {
    // The scrollable container element for the before & after text spans & the caret.
    // Not to be confused with the simulated scrollbar.
    let scroller: HTMLElement;

    // Identify the scroller element
    if(target && dom.Utils.instanceof(target, "HTMLSpanElement")) {
      scroller=target.parentNode as HTMLElement;
    } else if(target && (target.className != null && target.className.indexOf('keymanweb-input') >= 0)) {
      scroller=target.firstChild as HTMLElement;
    } else if(target && dom.Utils.instanceof(target, "HTMLDivElement")) {
      // Three possibilities:  the scroller, the scrollbar, & the blinking DIV of the caret.
      // A direct click CAN trigger events on the blinking element itself if well-timed.
      scroller=target;

      // Ensures we land on the scroller, not the caret.
      if(scroller.parentElement && scroller.parentElement.className.indexOf('keymanweb-input') < 0) {
        scroller = scroller.parentElement;
      }

      // scroller is now either the actual scroller or the scrollbar element.
      // We don't return either of these, and they both have the same parent element.
    } else if(target['kmw_ip']) { // In case it's called on a TouchAliasElement's base (aliased) element.
      return target['kmw_ip'] as TouchAliasElement;
    } else {
      // If it's not in any way related to a TouchAliasElement, simply return null.
      return null;
    }

    // And the actual target element
    let root = scroller.parentNode;
    if(root['base'] !== undefined) {
      return root as TouchAliasElement;
    } else {
      return null;
    }
  }

  export function constructTouchAlias(base?: HTMLElement): TouchAliasElement {
    let div = document.createElement("div");
    let ele = link(div, new TouchAliasData());

    if(base) {
      ele.initWithBase(base);
    } else {
      ele.init();
    }

    return ele;
  }

  /**
   * The core definition for touch-alias 'subclassing' of HTMLDivElement.
   * It's 'merged' with HTMLDivElement to avoid issues with DOM inheritance and DOM element creation.
   */
  class TouchAliasData {
    ['base']: HTMLElement = null; // NOT undefined; we can use this distinction for 'type-checking'.
    __preCaret:  HTMLSpanElement;
    __postCaret: HTMLSpanElement;
    __scrollDiv: HTMLDivElement;
    __scrollBar: HTMLDivElement;

    __caretSpan: HTMLSpanElement;
    __caretDiv: HTMLDivElement;
    __caretTimerId: number;
    __activeCaret: boolean = false;

    __executingCaretSearch: boolean = false;

    __resizeHandler: () => void;

    // The number of pixels a touch may lie within the 'next' character before we
    // bump the caret AFTER that next character.
    static readonly X_SNAP_LENIENCY_PIXELS: number = 5;

    private static device: Device;

    private static getDevice(): Device {
      if(!TouchAliasData.device) {
        let device = new com.keyman.Device();
        device.detect();

        TouchAliasData.device = device;
      }

      return TouchAliasData.device;
    }

    private static getOS(): string {
      return this.getDevice().OS;
    }

    isMultiline(): boolean {
      return this['base'] && this['base'].nodeName == "TEXTAREA";
    }

    initCaret(): void {
      /**
       * Create a caret to be appended to the scroller of the focussed input field.
       * The caret is appended to the scroller so that it will automatically be clipped
       * when the user manually scrolls it outside the element boundaries.
       * It is positioned exactly over the hidden span (__caretSpan) that is inserted
       * between the text spans before and after the insertion point.
       */
      this.__caretDiv = <HTMLDivElement> document.createElement('DIV');
      var cs=this.__caretDiv.style;
      cs.position='absolute';
      cs.height='16px';           // default height, actual height set from element properties
      cs.width='2px';
      cs.backgroundColor='blue';
      cs.border='none';
      cs.left=cs.top='0px';           // actual position set relative to parent when displayed
      cs.display='block';
      cs.visibility='hidden';
      cs.zIndex='9998';           // immediately below the OSK

      // Start the caret flash timer
      this.__caretTimerId = window.setInterval(this.flashCaret.bind(this), 500);
    }

    init() {
      // Remember, this type exists to be merged into HTMLDivElements, so this will work.
      // We have to trick TS a bit to make it happy, though.
      let divThis = <TouchAliasElement> (<any> this);
      divThis.className='keymanweb-input';

      // Add a scrollable interior div
      let d = this.__scrollDiv = document.createElement<'div'>('div');
      let xs = divThis.style;
      xs.overflow='hidden';
      xs.position='absolute';
      //xs.border='1px solid gray';
      xs.border='hidden';      // hide when element empty - KMW-3
      xs.border='none';
      xs.borderRadius='5px';

      // Add a scroll bar (horizontal for INPUT elements, vertical for TEXTAREA elements)
      var sb = this.__scrollBar = document.createElement<'div'>('div'), sbs=sb.style;
      sbs.position='absolute';
      sbs.height=sbs.width='4px';
      sbs.left=sbs.top='0';
      sbs.display='block';
      sbs.visibility='hidden';
      sbs.backgroundColor='#808080';
      sbs.borderRadius='2px';

      // And add two spans for the text content before and after the caret, and a caret span
      this.__preCaret=document.createElement<'span'>('span');
      this.__postCaret=document.createElement<'span'>('span');
      this.__caretSpan=document.createElement<'span'>('span');
      this.__preCaret.innerHTML = this.__postCaret.innerHTML = this.__caretSpan.innerHTML='';
      this.__preCaret.className = this.__postCaret.className = this.__caretSpan.className='keymanweb-font';

      d.appendChild(this.__preCaret);
      d.appendChild(this.__caretSpan);
      d.appendChild(this.__postCaret);
      divThis.appendChild(d);
      divThis.appendChild(sb);

      let ds=d.style;
      ds.position='relative';

      let preCaretStyle = this.__preCaret.style;
      let postCaretStyle = this.__postCaret.style;
      let styleCaret = this.__caretSpan.style;
      preCaretStyle.border=postCaretStyle.border='none';
      //preCaretStyle.backgroundColor='rgb(220,220,255)';
      //postCaretStyle.backgroundColor='rgb(220,255,220)'; //only for testing
      preCaretStyle.height=postCaretStyle.height='100%';

      // The invisible caret-positioning span must have a border to ensure that
      // it remains in the layout, but colour doesn't matter, as it is never visible.
      // Span margins are adjusted to compensate for the border and maintain text positioning.
      styleCaret.border='1px solid red';
      styleCaret.visibility='hidden';
      styleCaret.marginLeft=styleCaret.marginRight='-1px';

      ds.left='0px';
      ds.top='0px';
      ds.padding='0';
      ds.border='none';

      // Set the outer element padding *after* appending the element,
      // otherwise Firefox misaligns the two elements
      xs.padding='8px';

      // Set the tabindex to 0 to allow a DIV to accept focus and keyboard input
      // c.f. http://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/SCR29.html
      divThis.tabIndex=0;

      ds.minWidth=xs.width;
      ds.height=xs.height;

      this.initCaret();
    }

    initWithBase(base: HTMLElement) {
      this['base'] = base;
      this.init();

      let divThis = <TouchAliasElement> (<any> this);

      // There's quite a bit of setup for touch-alias elements that only occurs if it has an associated base.
      this['base']['kmw_ip'] = divThis;
      base.disabled = true;

      let baseStyle = window.getComputedStyle(base, null);
      let scrollDivStyle = this.__scrollDiv.style;
      let preCaretStyle  = this.__preCaret.style;
      let postCaretStyle = this.__postCaret.style;

      divThis.dir = base.dir;

      preCaretStyle.fontFamily = postCaretStyle.fontFamily = scrollDivStyle.fontFamily = baseStyle.fontFamily;

      // Set vertical centering for input elements
      if(base.nodeName.toLowerCase() == 'input') {
        if(!isNaN(parseInt(baseStyle.height,10))) {
          preCaretStyle.lineHeight = postCaretStyle.lineHeight = baseStyle.height;
        }
      }

      if(TouchAliasData.getOS() == 'Android' && baseStyle.backgroundColor == 'transparent') {
        scrollDivStyle.backgroundColor = '#fff';
      } else {
        scrollDivStyle.backgroundColor = baseStyle.backgroundColor;
      }

      if(divThis.base.nodeName.toLowerCase() == 'textarea') {
        preCaretStyle.whiteSpace=postCaretStyle.whiteSpace='pre-wrap'; //scroll vertically
      } else {
        preCaretStyle.whiteSpace=postCaretStyle.whiteSpace='pre';      //scroll horizontally
      }

      divThis.base.parentNode.appendChild(divThis);
      divThis.updateInput();

      let style = divThis.style;
      style.color=baseStyle.color;
      //style.backgroundColor=bs.backgroundColor;
      style.fontFamily=baseStyle.fontFamily;
      style.fontSize=baseStyle.fontSize;
      style.fontWeight=baseStyle.fontWeight;
      style.textDecoration=baseStyle.textDecoration;
      style.padding=baseStyle.padding;
      style.margin=baseStyle.margin;
      style.border=baseStyle.border;
      style.borderRadius=baseStyle.borderRadius;

      //xs.color='red';  //use only for checking alignment

      // Prevent highlighting of underlying element (Android)
      if('webkitTapHighlightColor' in style) {
        (<any>style).webkitTapHighlightColor='rgba(0,0,0,0)';
      }

      if(base instanceof base.ownerDocument.defaultView.HTMLTextAreaElement) {
        // Correct rows value if defaulted and box height set by CSS
        // The rows value is used when setting the caret vertically

        if(base.rows == 2) { // 2 is default value
          var h=parseFloat(baseStyle.height)-parseFloat(baseStyle.paddingTop)-parseFloat(baseStyle.paddingBottom),
            dh=parseFloat(baseStyle.fontSize), calcRows=Math.round(h/dh);
          if(calcRows > base.rows+1) {
            base.rows=calcRows;
          }
        }
        scrollDivStyle.width=style.width;
        scrollDivStyle.minHeight=style.height;
      } else {
        scrollDivStyle.minWidth=style.width;
        scrollDivStyle.height=style.height;
      }
      base.style.visibility='hidden'; // hide by default: KMW-3

      // Add an explicit event listener to allow the duplicated input element
      // to be adjusted for any changes in base element location or size
      // This will be called for each element after any rotation, as well as after user-initiated changes
      // It has to be wrapped in an anonymous function to preserve scope and be applied to each element.
      (function(xx: TouchAliasElement){
        xx.__resizeHandler = function(){
          /* A timeout is needed to let the base element complete its resizing before our
          * simulated element can properly resize itself.
          *
          * Not doing this causes errors if the input elements are resized for whatever reason, such as
          * changing languages to a text with greater height.
          */
          window.setTimeout(function (){
            xx.updateInput();
          }, 1);
        };

        xx.base.addEventListener('resize', xx.__resizeHandler, false);
        xx.base.addEventListener('orientationchange', xx.__resizeHandler, false);
      })(divThis);

      var textValue: string;

      if(base instanceof base.ownerDocument.defaultView.HTMLTextAreaElement
        || base instanceof base.ownerDocument.defaultView.HTMLInputElement) {
        textValue = base.value;
      } else {
        textValue = base.textContent;
      }

      // And copy the text content
      this.setText(textValue, null);
    }

    setText(t?: string, cp?: number): void {
      var tLen=0;
      var t1: string, t2: string;

      // Read current text if null passed (for caret positioning)
      if(t === null) {
        t1 = this.__preCaret.textContent;
        t2 = this.__postCaret.textContent;
        t  = t1 + t2;
      }

      if(cp < 0) {
        cp = 0;    //if(typeof t._kmwLength == 'undefined') return;
      }

      tLen=t._kmwLength();

      if(cp === null || cp === undefined || cp > tLen) {
        cp=tLen;
      }
      t1=t._kmwSubstr(0,cp);
      t2=t._kmwSubstr(cp);

      this.__preCaret.textContent=t1;
      this.__postCaret.textContent=t2;

      // Disable if a caret search is operational; no need to alter page layout or scroll just yet.
      if(!this.__executingCaretSearch) {
        this.updateBaseElement(); // KMW-3, KMW-29
      }
    }

    getTextBeforeCaret() {
      return this.__preCaret.textContent;
    }

    getTextAfterCaret() {
      return this.__postCaret.textContent;
    }

    setTextBeforeCaret(t: string): void {
      var tLen=0;

      // Collapse (trailing) whitespace to a single space for INPUT fields (also prevents wrapping)
      if(!this.isMultiline()) {
        t=t.replace(/\s+$/,' ');
      }
      this.__preCaret.textContent=t;
      // Test total length in order to control base element visibility
      tLen=t.length;
      tLen=tLen+this.__postCaret.textContent.length;

      if(!this.__executingCaretSearch) {
        this.finalizeCaret();
      }
    }

    getTextCaret(): number {
      return this.getTextBeforeCaret()._kmwLength();
    }

    setTextCaret(cp: number): void {
      this.setText(null,cp);
      this.showCaret();
    }

    /**
     * An outer wrapper for the caret position update function.  Disables unnecessary DOM-manipulation
     * (& layout-triggering) operations during the search while guaranteeing that normal caret updates
     * resume after the search, whether or not an error occurs.
    *
     * Some layout-triggering is still needed for the search to work, but the quantity is greatly reduced.
     * @param touchPageX  The target .pageX value for the caret
     * @param touchPageY  The target .pageY value for the caret
     */
    executeCaretSearch(touchPageX: number, touchPageY: number) {
      this.__executingCaretSearch = true;
      try {
        this.performCaretSearch(touchPageX, touchPageY);
      } finally {
        this.__executingCaretSearch = false;
        this.finalizeCaret();
      }
    }

    /**
     * The core functionality for efficiently determining the intended caret placement within
     * the text form of the context given the page coordinate of a `TouchEvent`.  Takes great
     * care to remain O(log N); some layout-triggering operations are required, making O(N)
     * unacceptable.
     *
     * Even a few thousand characters is enough to become unacceptably laggy if O(N).
     * @param touchPageX  The target .pageX value for the caret
     * @param touchPageY  The target .pageY value for the caret
     */
    private performCaretSearch(touchX: number, touchY: number) {
      const dy=document.body.scrollTop;
      const contextLength = this.getText()._kmwLength();
      let cpMin=0;
      let cpMax=contextLength;
      let cp=this.getTextCaret();

      // Vertical scrolling
      // instanceof this.base.[...] in case the element lies within an iframe.
      if(this.base instanceof this.base.ownerDocument.defaultView.HTMLTextAreaElement) {
        // Approximates the height of a row.
        const yRow=Math.round(this.base.offsetHeight/(this.base as HTMLTextAreaElement).rows);
        const maxY = touchY;
        const minY = touchY - yRow;

        // Performs a binary search for a valid caret based on the y-position.
        // cp:  the previously-set caret position.

        // Break the binary search if our final search window is extremely small.
        while(cpMax - cpMin > 1) {

          const y=dom.Utils.getAbsoluteY(this.__caretSpan)-dy;  //top of caret

          if(y > maxY && cp > cpMin) {
            // If caret's prior placement is below (after) the touch's y-pos...
            cpMax=cp;  // new max position
            cp=Math.round((cp+cpMin)/2); // guess the halfway mark
          } else if(y < minY && cp < cpMax) {
            // If caret's prior placement is above (before) the touch's y-pos - 1 row height...
            cpMin=cp; // new min posiiton
            cp=Math.round((cp+cpMax)/2); // guess the halfway mark
          } else {
            // Great guess:  the y-position lines up, so cp is within the target row.
            // At this point, the only thing that matters is that we've found ONE caret
            // position that matches the target line.
            break;
          }
          // Actively set our caret to the determined matching y-position.
          this.setTextCaret(cp);  // mutates `caret`'s position
        }

        // Tweak slightly if the caret position still falls out of bounds, but only enough to get in-bounds.
        // Since our final window is small, we only need single-position shifts here (if needed at all).
        if(dom.Utils.getAbsoluteY(this.__caretSpan)-dy > maxY && cp > cpMin) {
          this.setTextCaret(--cp); // mutates `caret`'s position
        }

        if(dom.Utils.getAbsoluteY(this.__caretSpan)-dy < minY && cp < cpMax) {
          this.setTextCaret(++cp); // mutates `caret`'s position
        }

        // Guarantees:  cp is 'close' to both bounds, as it lies within the target row.
        // Therefore, it caps the search interval for the x-coordinate versions of both cpMin and cpMax.
        //
        // Now to meet the pre-condition for the x-coord search later in the function:
        // we need those bounds to be [cpMin, cpMax] === [start of row, end of row], both within the same line.

        // Determine minimum caret position on the target row; prep the x-coord cpMin.
        // cpMin is guaranteed to lie strictly before the target row unless at the start of the first row.
        // It is neither guaranteed to have changed since its initialization nor to be close to the target row.
        let minCpMin = cpMin;
        let maxCpMin = cp;
        while(maxCpMin != minCpMin) {
          // Our logic will auto-increment if too low, so favor the lower index.
          const searchPt = Math.floor((maxCpMin+minCpMin)/2);
          this.setTextCaret(searchPt);

          const y=dom.Utils.getAbsoluteY(this.__caretSpan)-dy;  //top of caret
          if(y < minY) {
            // We already know it's not on this row, so the minimum possible index should be increased.
            cpMin = minCpMin = searchPt+1;
          } else {
            // Still in the same row, so the boundary can only be at or before this point.
            cpMin = maxCpMin = searchPt;
          }
        }

        // Determine maximum caret position on the target row; prep the x-coord cpMax.
        // cpMax is guaranteed to lie strictly after the target row unless at the end of the final row.
        // It is neither guaranteed to have changed since its initialization nor to be close to the target row.
        let minCpMax = cp;
        let maxCpMax = cpMax;
        while(maxCpMax != minCpMax) {
          // Our logic will auto-decrement if too high, so favor the higher index.
          const searchPt = Math.round((maxCpMax+minCpMax)/2);
          this.setTextCaret(searchPt);

          const y=dom.Utils.getAbsoluteY(this.__caretSpan)-dy;  //top of caret
          if(y > maxY) {
            // We already know it's not on this row, so the maximum possible index should be decreased.
            cpMax = maxCpMax = searchPt-1;
          } else {
            // Still in the same row, so the boundary can only be at or after this point.
            cpMax = minCpMax = searchPt;
          }
        }

        // Set the potential caret in the middle of the range.
        cp = Math.round((cpMin + cpMax)/2);
        this.setTextCaret(cp);
      }

      // Caret repositioning for horizontal scrolling of RTL text

      // snapOrder - 'snaps' the touch location in a manner corresponding to the 'ltr' vs 'rtl' orientation.
      // Think of it as performing a floor() function, but the floor depends on the origin's direction.
      const isRTL = (this as unknown as HTMLElement).dir == 'rtl';
      const snapOrder = isRTL ? (a, b) => a < b : (a, b) => a > b;

      // Used to signify a few pixels of leniency in the 'rtl'-appropriate direction for final
      // caret placement.
      const snapLeniency = isRTL ? -TouchAliasData.X_SNAP_LENIENCY_PIXELS : TouchAliasData.X_SNAP_LENIENCY_PIXELS;

      // Now to binary-search the x-coordinate.
      // Pre-condition:  [cpMin, cpMax] === [start of row, end of row], both within the same line.
      // Automatically met for `<input`>-based instances.
      // Break the binary search if our final search window is extremely small.
      while(cpMax - cpMin > 1) {
        const x=dom.Utils.getAbsoluteX(this.__caretSpan);  //left of caret

        if(snapOrder(x, touchX) && cp > cpMin) {
          cpMax=cp;
          cp=Math.round((cp+cpMin)/2);
        } else if(!snapOrder(x, touchX) && cp < cpMax) {
          cpMin=cp;
          cp=Math.round((cp+cpMax)/2);
        } else {
          break;
        }
        this.setTextCaret(cp);
      }

      // LTR:  if caret x-pos > touchPosition, push caret earlier.
      if(snapOrder(dom.Utils.getAbsoluteX(this.__caretSpan), touchX) && cp > cpMin) {
        this.setTextCaret(--cp);
      }

      // LTR:  if caret x-pos + leniency <= touchPosition, push caret later.
      // Allows the touch to "bleed over" a couple pixels into the next char without
      // bumping it later.
      if(!snapOrder(dom.Utils.getAbsoluteX(this.__caretSpan) + snapLeniency, touchX) && cp < cpMax) {
        this.setTextCaret(++cp);
      }
    }

    private finalizeCaret() {
      // Update the base element then scroll into view if necessary
      this.updateBaseElement(); //KMW-3, KMW-29
      this.scrollInput();
    }

    /**
     * Set content, visibility, background and borders of input and base elements (KMW-3,KMW-29)
     */
    updateBaseElement() {
      let e = <TouchAliasElement> (<any> this);

      // Only proceed if we actually have a base element.
      if(!e['base']) {
        return;
      }

      var Ldv = e.base.ownerDocument.defaultView;
      if(e.base instanceof Ldv.HTMLInputElement || e.base instanceof Ldv.HTMLTextAreaElement) {
        e.base.value = this.getText(); //KMW-29
      } else {
        e.base.textContent = this.getText();
      }

      let n = this.getText()._kmwLength();

      e.style.backgroundColor = (n==0 ? 'transparent' : window.getComputedStyle(e.base, null).backgroundColor);

      if(TouchAliasData.getOS() == 'iOS') {
        e.base.style.visibility=(n==0?'visible':'hidden');
      }
    }

    flashCaret(): void {
      // Significant change - each element manages its own caret, and its activation is managed through show/hideCaret()
      // without referencing core KMW code.  (KMW must thus check if the active element is a TouchAliasElement, then use these
      // methods as appropriate.)
      if(this.__activeCaret) {
        var cs=this.__caretDiv.style;
        cs.visibility = cs.visibility != 'visible' ? 'visible' : 'hidden';
      }
    };

    /**
     * Position the caret at the start of the second span within the scroller
     */
    showCaret() {
      var scroller=this.__scrollDiv, cs=this.__caretDiv.style, sp2=this.__caretSpan;

      // Attach the caret to this scroller and position it over the caret span
      if(this.__caretDiv.parentNode != <Node>scroller) {
        scroller.appendChild(this.__caretDiv);
      }

      cs.left=sp2.offsetLeft+'px';
      cs.top=sp2.offsetTop+'px';
      cs.height=(sp2.offsetHeight-1)+'px';
      cs.visibility='hidden';   // best to wait for timer to display caret
      this.__activeCaret = true;

      // Disable if a caret search is operational; no need to alter page layout or scroll just yet.
      if(!this.__executingCaretSearch) {
        // Scroll into view if required
        this.scrollBody();

        // Display and position the scrollbar if necessary
        this.setScrollBar();
      }
    }

    hideCaret() {
      var e= <TouchAliasElement> (<any> this);

      // Always copy text back to underlying field on blur
      if(e.base instanceof e.base.ownerDocument.defaultView.HTMLTextAreaElement
          || e.base instanceof e.base.ownerDocument.defaultView.HTMLInputElement) {
        e.base.value = this.getText();
      }

      // And set the scroller caret to the end of the element content (null preserves text)
      this.setText(null, 100000);

      // Set the element scroll to zero (or max for RTL INPUT)
      var ss=this.__scrollDiv.style;
      if(e.isMultiline()) {
        ss.top='0';
      } else {
        if(e.base.dir == 'rtl') {
          ss.left=(e.offsetWidth - this.__scrollDiv.offsetWidth-8)+'px';
        } else {
          ss.left='0';
        }
      }


      // And hide the caret and scrollbar
      if(this.__caretDiv.parentNode) {
        this.__caretDiv.parentNode.removeChild(this.__caretDiv);
      }

      this.__caretDiv.style.visibility='hidden';
      this.__scrollBar.style.visibility='hidden';

      this.__activeCaret = false;
    }

    getText(): string {
      return (<TouchAliasElement> (<any> this)).textContent;
    }

    updateInput() {
      if(this['base']) {
        let divThis = (<TouchAliasElement> (<any> this));

        var xs=divThis.style, b=divThis.base,
            s=window.getComputedStyle(b,null),
            mLeft=parseFloat(s.marginLeft),
            mTop=parseFloat(s.marginTop),
            x1=Utils.getAbsoluteX(b), y1=Utils.getAbsoluteY(b);

        var p=divThis.offsetParent as HTMLElement;
        if(p) {
          x1=x1-Utils.getAbsoluteX(p);
          y1=y1-Utils.getAbsoluteY(p);
        }

        if(isNaN(mLeft)) {
          mLeft=0;
        }
        if(isNaN(mTop)) {
          mTop=0;
        }

        xs.left=(x1-mLeft)+'px';
        xs.top=(y1-mTop)+'px';

        var w=b.offsetWidth, h=b.offsetHeight,
            pLeft=parseFloat(s.paddingLeft), pRight=parseFloat(s.paddingRight),
            pTop=parseFloat(s.paddingTop), pBottom=parseFloat(s.paddingBottom),
            bLeft=parseFloat(s.borderLeft), bRight=parseFloat(s.borderRight),
            bTop=parseFloat(s.borderTop), bBottom=parseFloat(s.borderBottom);

        // If using content-box model, must subtract the padding and border,
        // but *not* for border-box (as for WordPress PlugIn)
        var boxSizing='undefined';
        if(typeof(s.boxSizing) != 'undefined') {
          boxSizing=s.boxSizing;
        } else if(typeof(s.MozBoxSizing) != 'undefined') {
          boxSizing=s.MozBoxSizing;
        }

        if(boxSizing == 'content-box') {
          if(!isNaN(pLeft)) w -= pLeft;
          if(!isNaN(pRight)) w -= pRight;
          if(!isNaN(bLeft)) w -= bLeft;
          if(!isNaN(bRight)) w -= bRight;

          if(!isNaN(pTop)) h -= pTop;
          if(!isNaN(pBottom)) h -= pBottom;
          if(!isNaN(bTop)) h -= bTop;
          if(!isNaN(bBottom)) h -= bBottom;
        }

        if(TouchAliasData.getOS() == 'Android') {
          w++;
          h++;
        }

        xs.width=w+'px';
        xs.height=h+'px';
      }
    }

    /**
     * Scroll the input field horizontally (INPUT base element) or
     * vertically (TEXTAREA base element) to bring the caret into view
     * as text is entered or deleted form an element
     */
    scrollInput() {
      var scroller=this.__scrollDiv;
      let divThis = <TouchAliasElement> (<any> this);

      // Get the actual absolute position of the caret and the element
      var s2=this.__caretSpan,
        cx=dom.Utils.getAbsoluteX(s2),cy=dom.Utils.getAbsoluteY(s2),
        ex=dom.Utils.getAbsoluteX(divThis),ey=dom.Utils.getAbsoluteY(divThis),
        x=parseInt(scroller.style.left,10),
        y=parseInt(scroller.style.top,10),
        dx=0,dy=0;

      // Scroller offsets must default to zero
      if(isNaN(x)) x=0; if(isNaN(y)) y=0;

      // Scroll input field vertically if necessary
      if(divThis.isMultiline()) {
        var rowHeight=Math.round(divThis.offsetHeight/(<HTMLTextAreaElement> divThis.base).rows);
        if(cy < ey) {
          dy=cy-ey;
        }
        if(cy > ey+divThis.offsetHeight-rowHeight) {
          dy=cy-ey-divThis.offsetHeight+rowHeight;
        }
        if(dy != 0){
          scroller.style.top=(y<dy?y-dy:0)+'px';
        }
      } else { // or scroll horizontally if needed
        if(cx < ex+8) {
          dx=cx-ex-12;
        }
        if(cx > ex+divThis.offsetWidth-12) {
          dx=cx-ex-divThis.offsetWidth+12;
        }
        if(dx != 0) {
          scroller.style.left=(x<dx?x-dx:0)+'px';
        }
      }

      // Display the caret (and scroll into view if necessary)
      this.showCaret();
    }

    /**
     * Scroll the document body vertically to bring the active input into view
     */
    scrollBody(): void {
      // Note the deliberate lack of typing; we don't want to include KMW's core in isolated
      // element interface testing, so we can't use it here.
      var oskHeight: number = 0;

      if(window['keyman']) {
        var osk = window['keyman'].osk;
        if(osk && osk._Box) {
          oskHeight = osk._Box.offsetHeight;
        }
      }

      // Get the absolute position of the caret
      var s2=this.__caretSpan, y=dom.Utils.getAbsoluteY(s2), t=window.pageYOffset,dy=0;
      if(y < t) {
        dy=y-t;
      } else {
        dy=y-t-(window.innerHeight - oskHeight - s2.offsetHeight - 2);
        if(dy < 0) {
          dy=0;
        }
      }
      // Hide OSK, then scroll, then re-anchor OSK with absolute position (on end of scroll event)
      if(dy != 0) {
        window.scrollTo(0,dy+window.pageYOffset);
      }
    }

    /**
     * Display and position a scrollbar in the input field if needed
     */
    setScrollBar() {
      let e = <TouchAliasElement> (<any> this);

      // Display the scrollbar if necessary.  Added isMultiline condition to correct rotation issue KMW-5.  Fixed for 310 beta.
      var scroller=this.__scrollDiv, sbs=this.__scrollBar.style;
      if((scroller.offsetWidth > e.offsetWidth || scroller.offsetLeft < 0) && !e.isMultiline()) {
        sbs.height='4px';
        sbs.width=100*(e.offsetWidth/scroller.offsetWidth)+'%';
        sbs.left=100*(-scroller.offsetLeft/scroller.offsetWidth)+'%';
        sbs.top='0';
        sbs.visibility='visible';
      } else if(scroller.offsetHeight > e.offsetHeight || scroller.offsetTop < 0) {
        sbs.width='4px';
        sbs.height=100*(e.offsetHeight/scroller.offsetHeight)+'%';
        sbs.top=100*(-scroller.offsetTop/scroller.offsetHeight)+'%';
        sbs.left='0';
        sbs.visibility='visible';
      } else {
        sbs.visibility='hidden';
      }
    }
  }
}