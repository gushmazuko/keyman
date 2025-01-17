#!/usr/bin/env bash

set -e
set -u

## START STANDARD BUILD SCRIPT INCLUDE
# adjust relative paths as necessary
THIS_SCRIPT="$(greadlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink -f "${BASH_SOURCE[0]}")"
# NOTE: this is slightly non-standard; see longer discussion below
## END STANDARD BUILD SCRIPT INCLUDE

# This script does not use our normal shared build-utils.sh because Linux package builds
# cannot access anything outside of the `core` directory. This means that:
# 1. `shellHelperFunctions.sh`, `VERSION.md` and `TIER.md` are copied here by the script
#    `linux/scripts/dist.sh` for inclusion locally in Linux package builds.
# 2. `getversion.sh` and `gettier.sh` will use current folder if we can't access the
#    root level `VERSION.md` and `TIER.md`.
# 3. `$SCRIPTS_DIR` is set to this folder by the package build Makefile
#    `core/debian/rules`
SCRIPTS_DIR=${SCRIPTS_DIR:-$(dirname "$THIS_SCRIPT")/../resources}
. "${SCRIPTS_DIR}/shellHelperFunctions.sh"

THIS_DIR="$(dirname "$THIS_SCRIPT")"

pushd $THIS_DIR > /dev/null
VERSION=$(./getversion.sh)
TIER=$(./gettier.sh)
popd > /dev/null

display_usage() {
  echo "usage: build.sh [build options] [targets] [-- options to pass to c++ configure]"
  echo
  echo "Build options:"
  echo "  --debug, -d       Debug build"
  echo "  --target, -t      Target path (linux,macos only, default build/)"
  echo "  --platform, -p    Platform to build (wasm or native, default native)"
  echo
  echo "Targets (all except install if not specified):"
  echo "  clean             Clean target path"
  echo "  configure         Configure libraries (linux,macos only)"
  echo "  build             Build all libraries"
  echo "    build-cpp         Build c++ libraries"
  echo "  tests             Run all tests"
  echo "    tests-cpp         Run c++ tests"
  echo "  install           Install all libraries"
  echo "    install-cpp       Install c++ libraries"
  echo "  uninstall         Uninstall all libraries"
  echo "    uninstall-cpp     Uninstall c++ libraries"
  echo
  echo "C++ libraries will be in:       TARGETPATH/<arch>/<buildtype>/src"
  echo "WASM libraries will be in:      TARGETPATH/wasm/<buildtype>/src"
  echo "On Windows, <arch> will be 'x86' or 'x64'; elsewhere it is 'arch'"
  exit 0
}

get_builder_OS

MESON_TARGET=release
HAS_TARGET=false
CLEAN=false
CONFIGURE=false
BUILD_CPP=false
TESTS_CPP=false
INSTALL_CPP=false
UNINSTALL_CPP=false
QUIET=false
TARGET_PATH="$THIS_DIR/build"
ADDITIONAL_ARGS=
PLATFORM=native

# Parse args
shopt -s nocasematch

while [[ $# -gt 0 ]] ; do
  key="$1"
  case $key in
    --debug|-d)
      MESON_TARGET=debug
      ;;
    --help|-\?)
      display_usage
      ;;
    --target|-t)
      TARGET_PATH=$(readlink -f "$2")
      shift
      ;;
    --platform|-p)
      PLATFORM="$2"
      shift
      ;;
    configure)
      HAS_TARGET=true
      CONFIGURE=true
      ;;
    clean)
      HAS_TARGET=true
      CLEAN=true
      ;;
    build)
      HAS_TARGET=true
      BUILD_CPP=true
      ;;
    *-rust)
      echo "$key: Rust was removed in <https://github.com/keymanapp/keyman/issues/6290>"
      ;;
    build-cpp)
      HAS_TARGET=true
      BUILD_CPP=true
      ;;
    tests)
      HAS_TARGET=true
      TESTS_CPP=true
      ;;
    tests-cpp)
      HAS_TARGET=true
      TESTS_CPP=true
      ;;
    install)
      HAS_TARGET=true
      INSTALL_CPP=true
      ;;
    install-cpp)
      HAS_TARGET=true
      INSTALL_CPP=true
      ;;
    uninstall)
      HAS_TARGET=true
      # ninja records the files it installs, so unless we install first we don't know
      # what to uninstall. Installing will overwrite the existing files, if we then
      # then uninstall the files get removed - unless previously we had additional files.
      INSTALL_CPP=true
      UNINSTALL_CPP=true
      ;;
    uninstall-cpp)
      HAS_TARGET=true
      INSTALL_CPP=true
      UNINSTALL_CPP=true
      ;;
    --)
      shift
      ADDITIONAL_ARGS=$@
      break
      ;;
    *)
      fail "Invalid parameters. Use --help for help"
  esac
  shift
done

if ! $HAS_TARGET; then
  if [ ! -f "$TARGET_PATH" ]; then
    CONFIGURE=true
  fi
  BUILD_CPP=true
  TESTS_CPP=true
fi

if [[ $PLATFORM == wasm ]]; then
  MESON_PATH="$TARGET_PATH/wasm/$MESON_TARGET"
else
  MESON_PATH="$TARGET_PATH/arch/$MESON_TARGET"
fi

displayInfo "" \
    "VERSION: $VERSION" \
    "TIER: $TIER" \
    "PLATFORM: $PLATFORM" \
    "CONFIGURE: $CONFIGURE" \
    "CLEAN: $CLEAN" \
    "BUILD_CPP: $BUILD_CPP" \
    "TESTS_CPP: $TESTS_CPP" \
    "INSTALL_CPP: $INSTALL_CPP" \
    "UNINSTALL_CPP: $UNINSTALL_CPP" \
    "MESON_TARGET: $MESON_TARGET" \
    "TARGET_PATH: $TARGET_PATH" \
    ""

clean() {
  rm -rf "$TARGET_PATH/"
}

path_remove() {
  # Delete path by parts so we can never accidentally remove sub paths
  PATH=${PATH//":$1:"/":"} # delete any instances in the middle
  PATH=${PATH/#"$1:"/} # delete any instance at the beginning
  PATH=${PATH/%":$1"/} # delete any instance in the at the end
}

build_windows() {
  # Build targets for Windows

  # Build the meson targets, both x86 and x64 also
  # We need to use a batch file here so we can get
  # the Visual Studio build environment with vcvarsall.bat
  # TODO: if PATH is the only variable required, let's try and
  #       eliminate this difference in the build process

  if $BUILD_CPP; then
    if $TESTS_CPP; then
      echo_heading "======= Building and Testing C++ library for Windows (x86, x64) ======="
      cmd //C build.bat all $MESON_TARGET build tests
    else
      echo_heading "======= Building C++ library for Windows (x86, x64) ======="
      cmd //C build.bat all $MESON_TARGET build
    fi
  elif $TESTS_CPP; then
    echo_heading "======= Testing C++ library for Windows (x86, x64) ======="
    cmd //C build.bat all $MESON_TARGET tests
  fi
}

build_standard() {
  local BUILD_PLATFORM="$1"
  local ARCH="$2"
  local RUSTARCH=${3:-}
  # RUSTARCH is not currently used.
  if [ $# -gt 3 ]; then
    shift 3
    local STANDARD_MESON_ARGS="$*"
  else
    local STANDARD_MESON_ARGS=
  fi

  # Build meson targets
  if $CONFIGURE; then
    echo_heading "======= Configuring C++ library for $BUILD_PLATFORM ======="
    pushd "$THIS_DIR" > /dev/null
    meson setup "$MESON_PATH" --werror --buildtype $MESON_TARGET $STANDARD_MESON_ARGS $ADDITIONAL_ARGS
    popd > /dev/null
  fi

  if $BUILD_CPP; then
    echo_heading "======= Building C++ library for $BUILD_PLATFORM ======="
    pushd "$MESON_PATH" > /dev/null
    ninja
    popd > /dev/null
  fi

  if $TESTS_CPP; then
    echo_heading "======= Testing C++ library for $BUILD_PLATFORM ======="
    pushd "$MESON_PATH" > /dev/null
    meson test --print-errorlogs
    popd > /dev/null
  fi

  if $INSTALL_CPP; then
    echo_heading "======= Installing C++ libraries for $BUILD_PLATFORM ======="
    pushd "$MESON_PATH" > /dev/null
    ninja install
    popd > /dev/null
  fi

  if $UNINSTALL_CPP; then
    echo_heading "======= Uninstalling C++ libraries for $BUILD_PLATFORM ======="
    pushd "$MESON_PATH" > /dev/null
    ninja uninstall
    popd > /dev/null
  fi
}

locate_emscripten() {
  local EMCC=`which emcc`
  [ -z "$EMCC" ] && fail "Could not locate emscripten (emcc)"
  EMSCRIPTEN_BASE="$(dirname "$EMCC")"
}

build_meson_cross_file_for_wasm() {
  if [ $os_id == win ]; then
    local R=$(cygpath -w $(echo $EMSCRIPTEN_BASE) | sed 's_\\_\\\\_g')
  else
    local R=$(echo $EMSCRIPTEN_BASE | sed 's_/_\\/_g')
  fi
  sed -e "s/\$EMSCRIPTEN_BASE/$R/g" wasm.build.$os_id.in > wasm.build
}

###

if $CLEAN; then
  clean
fi

if [[ $PLATFORM == native ]]; then
  case $os_id in
    "linux")
      build_standard $os_id arch
      ;;
    "mac")
      build_standard $os_id arch
      ;;
    "win")
      build_windows
      ;;
  esac
else
  locate_emscripten
  build_meson_cross_file_for_wasm
  build_standard wasm wasm wasm32-unknown-unknown --cross-file wasm.defs.build --cross-file wasm.build --default-library static
fi
