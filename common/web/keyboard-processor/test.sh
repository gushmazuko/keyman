#!/usr/bin/env bash

set -eu

# Include useful testing resource functions
## START STANDARD BUILD SCRIPT INCLUDE
# adjust relative paths as necessary
THIS_SCRIPT="$(greadlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink -f "${BASH_SOURCE[0]}")"
. "$(dirname "$THIS_SCRIPT")/../../../resources/build/build-utils.sh"
## END STANDARD BUILD SCRIPT INCLUDE

. "$KEYMAN_ROOT/resources/shellHelperFunctions.sh"

# We should work within the script's directory, not the one we were called in.
cd "$THIS_SCRIPT_PATH"

# A simple utility script to facilitate unit-testing for the LM Layer.
# It's rigged to be callable by NPM to facilitate testing during development when in other folders.

display_usage ( ) {
  echo "test.sh [-skip-package-install] [-CI] [ -? | -h | -help]"
  echo "  -CI                    to perform continuous-integration friendly tests and reporting formatted for TeamCity"
  echo "  -? | -h | -help        to display this help information"
  echo "  -skip-package-install  to bypass refreshing dependencies.  Useful when called by scripts that pre-fetch"
  echo ""
  exit 0
}

# Defaults
FLAGS=
CI_REPORTING=0
FETCH_DEPS=true

# Parse args
while [[ $# -gt 0 ]] ; do
  key="$1"
  case $key in
    -skip-package-install|-S)
      FETCH_DEPS=false
      ;;
    -h|-help|-\?)
      display_usage
      exit
      ;;
    -CI)
      CI_REPORTING=1
      ;;
  esac
  shift # past argument
done

if [ $FETCH_DEPS = true ]; then
  verify_npm_setup
fi

test-headless ( ) {
  if (( CI_REPORTING )); then
    FLAGS="$FLAGS --reporter mocha-teamcity-reporter"
  fi

  npm run mocha -- --recursive $FLAGS ./tests/cases/
}

# Build test dependency
pushd "$KEYMAN_ROOT/common/web/recorder/src"
./build.sh -skip-package-install || fail "recorder-core compilation failed."
popd

# Compile web's `keyboard-processor` module."
npm run tsc -- -b src/tsconfig.bundled.json || fail "Failed to compile the testing version of the core/web/keyboard-processor module."

# Run headless (browserless) tests.
echo_heading "Running Keyboard Processor test suite"
test-headless || fail "Keyboard Processor tests failed!"

