module.exports = function(config) {
  var base = require("./base.conf.js");

  var timeouts = base.client.args[0];
  var browserStackModifier = 10;

  for(key in timeouts) {
    if(typeof timeouts[key] == 'number') {
      timeouts[key] = timeouts[key] * browserStackModifier;
    }
  }

  timeouts.mobileFactor = 2; // Extra timeout padding for running on a remote mobile device.

  /*
   * Definition of utility functions for managing our browser lists.
   */
  var mergeLaunchers = function() {
    var mergedDefs = {};
    var i;
    for(i=0; i < arguments.length; i++) {
      for(var name in arguments[i]) {
        mergedDefs[name] = arguments[i][name];

        // Necessary for Karma to process it properly.
        mergedDefs[name].base = 'BrowserStack';
      }
    }

    return mergedDefs;
  }

  var toBrowserList = function(mergedSet) {
    var list = [];
    for(var name in mergedSet) {
      list.push(name);
    }

    return list;
  }

  /*
   * Definition of browser sets possibly relevant for testing.
   */
  var CURRENT_MAC_LAUNCHERS = {
    bs_firefox_mac: {
      browser: 'firefox',
      browser_version: '62',
      os: 'OS X',
      os_version: 'Mojave'
    },
    bs_safari_mac_m: {
      browser: 'safari',
      browser_version: '13',
      os: 'OS X',
      os_version: 'Catalina'
    },
    bs_chrome_mac: {
      browser: 'chrome',
      browser_version: '70.0',
      os: 'OS X',
      os_version: 'Mojave'
    }
  };

  // BrowserStack does not appear to properly support automated JavaScript testing at this time.
  // See https://www.browserstack.com/list-of-browsers-and-platforms?product=js_testing for the reference.
  var CURRENT_IOS_LAUNCHERS = {}; /*{
    bs_iphoneX: {
      device: 'iPhone X', // Ideally, we'd use 'iPhone X', but BrowserStack's version is being problematic lately.
      real_mobile: true,
      os: 'ios',
      os_version: '11.0'
    },
    bs_ipad6: {
      device: 'iPad 5th',
      real_mobile: true,
      os: 'ios',
      os_version: '11.0'
    }
  };*/

  var CURRENT_WIN_LAUNCHERS = {
    bs_firefox_win: {
      os: 'Windows',
      os_version: '10',
      browser: 'firefox',
      browser_version: '62.0'
    },
    bs_chrome_win: {
      os: 'Windows',
      os_version: '10',
      browser: 'chrome',
      browser_version: '70.0'
    }
  }

  var CURRENT_ANDROID_LAUNCHERS = {
    bs_chrome_android: {
      os: 'android',
      os_version: '7.1',
      browser: 'chrome',
      real_mobile: true,
      device: 'Samsung Galaxy Note 8'
    }
  }

  // Sadly, legacy IE isn't very testable with Mocha.  One of its dependencies requires a feature that is IE11+.

  /*
   * Final selection of the sets to be used for BrowserStack testing.
   */
  var FINAL_LAUNCHER_DEFS = mergeLaunchers( CURRENT_ANDROID_LAUNCHERS,
                                            CURRENT_IOS_LAUNCHERS,
                                            CURRENT_WIN_LAUNCHERS,
                                            CURRENT_MAC_LAUNCHERS);

  var FINAL_BROWSER_LIST = toBrowserList(FINAL_LAUNCHER_DEFS);

  /*
   * Final definition of our BrowserStack testing Karma configuration.
   */

  var specifics = {
    // BrowserStack configuration options
    browserStack: {
      video: true,
      browserDisconnectTimeout: 6e4, // 1 minute (60s => 60,000ms)
      retryLimit: 3, // 0 is ignored.
      startTunnel: true,
    },

    // Attempts to avoid generating a 'fail' exit code if one of our selected browsers on BrowserStack goes poof.
    failOnEmptyTestSuite: false,

    captureTimeout: 1.2e5, // in milliseconds
    browserNoActivityTimeout: 6e4,
    browserDisconnectTimeout: 6e4,
    browserDisconnectTolerance: 3,

    // Avoids generating a 'fail' exit code if one of our selected browsers on BrowserStack goes poof.
    failOnEmptyTestSuite: false,

    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://npmjs.org/browse/keyword/karma-reporter
    reporters: ['teamcity', 'BrowserStack'],

    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_DEBUG,

    // Concurrency level
    // For CI, it really helps to keep a nice, clean set of output logs.
    concurrency: 5,

    customLaunchers: FINAL_LAUNCHER_DEFS,

    browsers: FINAL_BROWSER_LIST
  };

  config.set(Object.assign(specifics, base));
}
