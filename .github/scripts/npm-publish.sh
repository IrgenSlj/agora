#!/usr/bin/env bash
# Publish the package in the current directory to npm.
#
# Auth is either trusted publishing (OIDC, nothing to configure in the repo) or
# an NPM_TOKEN automation token. Prefer the former: there is no credential to
# rotate, leak, or forget to renew.
#
# Expects: NPM_TOKEN (may be empty), TAG (dist-tag to publish under).
set -euo pipefail

if [ -n "${NPM_TOKEN:-}" ]; then
  echo "Authenticating with NPM_TOKEN."
  npm config set //registry.npmjs.org/:_authToken="$NPM_TOKEN"
else
  echo "No NPM_TOKEN set — relying on npm trusted publishing (OIDC)."
  echo "If this fails with ENEEDAUTH, enable a trusted publisher for this"
  echo "package on npmjs.com, or add an NPM_TOKEN repo secret."
fi

# --provenance is redundant under trusted publishing and required under a
# token; passing it always keeps both paths producing an attestation. A trust
# plane that ships unattested builds would be arguing against itself.
npm publish --tag "${TAG:-latest}" --provenance
