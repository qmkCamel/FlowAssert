"""Export existing physical runs for the local publicity page; never changes images."""
from pathlib import Path
import argparse, hashlib, json, shutil
root = Path(__file__).resolve().parents[1]
out = root / 'docs/communications/local-case-assets'
parser = argparse.ArgumentParser(description=__doc__)
positive = parser.add_mutually_exclusive_group(required=True)
positive.add_argument('--success', type=Path, help='Actual positive run directory')
positive.add_argument('--collection', type=Path, help='Sequential capture collection with original run references')
parser.add_argument('--failure', type=Path, required=True, help='Actual deliberate-negative run directory')
parser.add_argument('--output', type=Path, default=out, help='Explicit local output directory; files are not sanitized')
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
sources = {'failure': args.failure}
if args.success:
    sources['success'] = args.success
data = {}
if args.collection:
    collection = json.loads(args.collection.read_text())
    steps = []
    dest = out / 'success'
    dest.mkdir(exist_ok=True)
    for i, entry in enumerate(collection['runs']):
        if Path(entry['id']).name != entry['id'] or entry['id'] in ('.', '..'):
            raise ValueError('Invalid run identity')
        src = args.collection.parent / 'runs' / entry['id']
        manifest = json.loads((src / 'manifest.json').read_text())
        # The HTTP read model adds a resultProjection; identity and original
        # step evidence must still match the immutable on-disk manifest.
        if any(manifest[k] != entry[k] for k in ('id', 'yaml', 'steps', 'startedAt')) or manifest['provider'] != 'appium':
            raise ValueError('Collection does not match original manifest')
        step = dict(manifest['steps'][0])
        step['index'], step['label'], step['runId'] = i + 1, step.get('label') or step['kind'], manifest['id']
        step['evidence'] = []
        for evidence in manifest['steps'][0]['evidence']:
            name = evidence['name']
            if Path(name).name != name:
                raise ValueError('Invalid evidence filename')
            blob = (src / name).read_bytes()
            if len(blob) != evidence['bytes'] or hashlib.sha256(blob).hexdigest() != evidence['sha256']:
                raise ValueError('Evidence mismatch')
            exported = f"capture-{i+1}-{name}"
            (dest / exported).write_bytes(blob)
            step['evidence'].append({**evidence, 'name': exported})
            if name.endswith('.xml'):
                step['xml'] = blob.decode('utf-8')
        steps.append(step)
        shutil.copy2(src / 'manifest.json', dest / f"capture-{i+1}-manifest.json")
    data['success'] = {'id': 'sequential-capture', 'captureLabel': '分步截图采集，非一次完整回归',
                       'startedAt': collection['runs'][0]['startedAt'], 'endedAt': collection['runs'][-1]['endedAt'],
                       'yaml': collection['original'], 'steps': steps, 'verdict': 'not-evaluated'}
for key, rel in sources.items():
    src = rel.resolve()
    manifest = json.loads((src / 'manifest.json').read_text())
    if manifest['provider'] != 'appium' or manifest['platform'] not in ('android', 'ios'):
        raise ValueError('Expected an Android or iOS Appium run; device kind must be checked independently')
    if manifest['verdict'] != ('pass' if key == 'success' else 'fail'):
        raise ValueError('Run verdict does not match the selected case')
    dest = out / key
    dest.mkdir(exist_ok=True)
    for step in manifest['steps']:
        step['label'] = step.get('label') or step['kind']
        for evidence in step['evidence']:
            name = evidence['name']
            if Path(name).name != name:
                raise ValueError('Invalid evidence filename')
            blob = (src / name).read_bytes()
            if len(blob) != evidence['bytes'] or hashlib.sha256(blob).hexdigest() != evidence['sha256']:
                raise ValueError(f'Evidence mismatch: {name}')
            (dest / name).write_bytes(blob)
            if name.endswith('.xml'):
                step['xml'] = blob.decode('utf-8')
    for name in ['manifest.json', 'flow.yaml']:
        shutil.copy2(src / name, dest / name)
    data[key] = manifest
(out / 'cases.js').write_text('window.physicalCases = ' + json.dumps(data, ensure_ascii=False) + ';\n')
print('Exported cases with byte-for-byte verified PNG/XML. Assets remain local.')
