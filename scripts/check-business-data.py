#!/usr/bin/env python3
"""Verify generated indexes, detail chunks, and cross-dataset references."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parents[1] / 'website/public/business-data'
manifest = json.loads((root / 'manifest.json').read_text())
datasets = {}
for kind, info in manifest['datasets'].items():
    index = json.loads((root / f'{kind}-index.json').read_text())
    rows = [r for chunk in range(info['chunks']) for r in json.loads((root / f'{kind}-{chunk}.json').read_text())]
    assert len(index) == len(rows) == info['count'], kind
    ids = {r['id'] for r in rows}
    assert len(ids) == len(rows), kind
    assert ids == {r['id'] for r in index}, kind
    chunk_ids = {n: {r['id'] for r in json.loads((root / f'{kind}-{n}.json').read_text())} for n in range(info['chunks'])}
    for entry in index:
        assert entry['id'] in chunk_ids[entry['chunk']], entry['id']
    datasets[kind] = {r['id']:r for r in rows}
for contact in datasets['contacts'].values(): assert contact['investor_id'] in datasets['investors']
for row in datasets['arr'].values():
    assert row['company_id'] in datasets['companies']
    assert float(row['arr_usd']) >= 0
    assert row['arr_kind'] in ('reported','estimate')
for firm in datasets['investors'].values():
    assert int(firm['contacts_count']) == sum(r['investor_id'] == firm['id'] for r in datasets['contacts'].values())
assert all(p.stat().st_size < 25 * 1024 * 1024 for p in root.glob('*.json'))
print('Business data integrity passed: counts, unique IDs, chunk references, firm contacts, ARR links and file sizes.')
