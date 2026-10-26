"""Tag every local file reference with a version so browsers fetch fresh code after each update.

Run before committing: python3 tools/stamp.py
"""
import pathlib, re, time

root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M%S')
local = r"((?:\./)?[\w-]+\.(?:js|css))(?:\?v=\d+)?"
for f in root.glob('*.js'):
    s = f.read_text()
    s = re.sub(r"(from\s+'\./[\w-]+\.js)(?:\?v=\d+)?'", lambda m: f"{m.group(1)}?v={v}'", s)
    f.write_text(s)
html = root / 'index.html'
s = html.read_text()
s = re.sub(r'(src|href)="' + local + '"', lambda m: f'{m.group(1)}="{m.group(2)}?v={v}"', s)
html.write_text(s)
print('stamped', v)
