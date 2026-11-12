# The conformance suite's Config OP plan hard-requires an https:// issuer
# (verified against the suite's own source, see ../README.md) — the compose
# stack odudu ships for local development and the container job serves
# plain HTTP. This terminates TLS in front of the plain-HTTP odudu
# container so the same server, unmodified, can be reached over https.
# The certificate is self-signed and baked in at build time: it is
# throwaway, valid only for the lifetime of this conformance run, and
# never used outside this compose stack.
# digest of the multi-arch index; Dependabot moves it
FROM nginx:1.31-alpine@sha256:713fc2ebfd92e8217db451477182ee91944b123d2b1ee9fd5a8c6e91ca6c3a11
RUN apk add --no-cache openssl \
  && openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
       -keyout /etc/nginx/conformance.key \
       -out /etc/nginx/conformance.crt \
       -subj "/CN=odudu-conformance" \
       -addext "subjectAltName=DNS:proxy,DNS:localhost"
COPY nginx.conf /etc/nginx/conf.d/default.conf
