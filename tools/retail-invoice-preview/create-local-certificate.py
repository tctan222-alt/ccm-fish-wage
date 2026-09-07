"""Generate a short-lived local HTTPS test certificate; never install trust."""

import argparse
from datetime import datetime, timedelta, timezone
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ip', action='append', required=True, help='Computer LAN IP; repeat for multiple addresses')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent / '.local-https')
    args = parser.parse_args()
    addresses = {ipaddress.ip_address('127.0.0.1')}
    for value in args.ip:
        address = ipaddress.ip_address(value)
        if address.is_unspecified or address.is_multicast or not address.is_private:
            parser.error('--ip must be a specific private LAN or loopback address')
        addresses.add(address)

    output = args.output.resolve()
    filenames = ('server.key', 'server.crt', 'ccm-retail-preview-ca.cer')
    if any((output / filename).exists() for filename in filenames):
        parser.error('Certificate files already exist; use a new --output directory instead of overwriting keys')

    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=7)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f'CCM Retail local preview {expires:%Y-%m-%d}')])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now - timedelta(minutes=5)).not_valid_after(expires)
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(True, False, False, False, False, True, True, None, None), critical=True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
          .sign(ca_key, hashes.SHA256()))

    server_key = ec.generate_private_key(ec.SECP256R1())
    server = (x509.CertificateBuilder()
              .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'CCM Retail local preview')]))
              .issuer_name(ca_name).public_key(server_key.public_key()).serial_number(x509.random_serial_number())
              .not_valid_before(now - timedelta(minutes=5)).not_valid_after(expires)
              .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
              .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'), *[x509.IPAddress(address) for address in sorted(addresses, key=str)]]), critical=False)
              .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
              .add_extension(x509.KeyUsage(True, False, False, False, False, False, False, None, None), critical=True)
              .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
              .sign(ca_key, hashes.SHA256()))

    output.mkdir(parents=True, exist_ok=True)
    # The CA signing key is deliberately never persisted. Only the local server key remains.
    (output / 'server.key').write_bytes(server_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (output / 'server.crt').write_bytes(server.public_bytes(serialization.Encoding.PEM))
    (output / 'ccm-retail-preview-ca.cer').write_bytes(ca.public_bytes(serialization.Encoding.DER))
    print(f'Created local-only certificate files in {output}')
    print(f'Expires: {expires.isoformat()}')
    print(f'Public CA SHA-256: {ca.fingerprint(hashes.SHA256()).hex()}')
    print('No device trust settings or firewall permissions were changed.')


if __name__ == '__main__':
    main()
