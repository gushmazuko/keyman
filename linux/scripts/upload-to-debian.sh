#!/usr/bin/env bash
set -eu

usage()
{
    cat - <<- END

${0} -k <Debian signing key> [-n] [--push]

Create source package for latest stable release and upload to Debian,
and update (and optionally push) changelog file.

    -k <key>    The PGP key used to sign the source package
    -n          Simulate upload
    --push      Push changelog changes to GitHub
    --help      Display usage help

Requires an entry in ~/.dput.cf:
    [mentors]
    fqdn = mentors.debian.net
    incoming = /upload
    method = https
    allow_unsigned_uploads = 0
    progress_indicator = 2
    allowed_distributions = .*
END
}


## START STANDARD BUILD SCRIPT INCLUDE
# adjust relative paths as necessary
THIS_SCRIPT="$(greadlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink -f "${BASH_SOURCE[0]}")"
. "$(dirname "$THIS_SCRIPT")/../../resources/build/build-utils.sh"
## END STANDARD BUILD SCRIPT INCLUDE

. "$KEYMAN_ROOT/resources/shellHelperFunctions.sh"

NOOP=
PUSH=
DEBKEYID=

while (( $# )); do
    case $1 in
        -k) shift; [ ! $# -eq 0 ] && DEBKEYID=$1 || fail "Error: The last argument is missing a value. Exiting.";;
        -n) NOOP=: ;;
        --help) usage ; exit 0 ;;
        --push) PUSH=1 ;;
        *) fail "Error: Unexpected argument \"$1\". Exiting." ;;
    esac
    shift || fail "Error: The last argument is missing a value. Exiting."
done

if [ -z "$DEBKEYID" ]; then
    usage
    exit 2
fi

if ! git diff --quiet; then
    fail "You have changed files in your git working directory. Exiting."
fi

echo_heading "Fetching latest changes"
git fetch -p origin
stable_branch=$(git branch -r | grep origin/stable- | sort | tail -1)
stable_branch=${stable_branch##* }
# Checkout stable branch so that `scripts/debian.sh` picks up correct version
git checkout ${stable_branch#origin/}

cd "$KEYMAN_ROOT/linux"
echo_heading "Building source package"
DIST=unstable scripts/debian.sh
cd debianpackage/
echo_heading "Signing source package"
debsign -k$DEBKEYID --re-sign *.changes
echo_heading "Uploading packages to mentors.debian.net"
$NOOP dput mentors *.changes
cd ..

echo_heading "Updating changelog"
# base changelog branch on remote stable branch
git checkout -B chore/linux/changelog $stable_branch
cp debianpackage/keyman-*/debian/changelog debian/
git add debian/changelog
git commit -m "chore(linux): Update debian changelog"
if [ -n "$PUSH" ]; then
    $NOOP git push origin chore/linux/changelog
fi

git checkout -B chore/linux/cherry-pick/changelog origin/master
git cherry-pick -x chore/linux/changelog
if [ -n "$PUSH" ]; then
    $NOOP git push origin chore/linux/cherry-pick/changelog
fi

echo_heading "Finishing"
git checkout master
