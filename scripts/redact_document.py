from pathlib import Path
import html
import io
import re
import zipfile
import xml.etree.ElementTree as ET

target = Path('HRMS_Architecture.docx')
original = target.read_bytes()
with zipfile.ZipFile(io.BytesIO(original)) as source:
    parts = {item.filename: source.read(item.filename) for item in source.infolist()}
    secrets = set()
    for name, data in parts.items():
        if name.endswith('.xml'):
            text = ' '.join(ET.fromstring(data).itertext())
            secrets.update(re.findall(r'(?i)password\s*[:=]\s*(?!\[REDACTED\])([^\s]+)', text))
    for secret in secrets:
        encoded = html.escape(secret, quote=False).encode()
        if not any(encoded in data for data in parts.values()):
            raise RuntimeError('Split credential requires manual redaction')
        parts = {name: data.replace(encoded, b'[REDACTED]') for name, data in parts.items()}
    destination = io.BytesIO()
    with zipfile.ZipFile(destination, 'w') as output:
        for item in source.infolist():
            output.writestr(item, parts[item.filename])
target.write_bytes(destination.getvalue())
print(f'Redacted {len(secrets)} password expression(s); no values logged.')
