#!/usr/bin/env python3
"""Build a static, paginated business directory from four Lounge CSV exports.
Usage: python3 scripts/import-business-data.py /path/to/csv/directory
"""
import csv, hashlib, json, pathlib, sys, urllib.parse, collections
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path.home() / 'Downloads'
OUT = ROOT / 'website/public/business-data'
OUT.mkdir(parents=True, exist_ok=True)
FILES = {'companies':'lounge-ai-companies-14471.csv','investors':'lounge-ai-investors-2026-10.csv','contacts':'lounge-ai-investor-contacts-2026-10.csv','arr':'lounge-ai-arr-leaderboard-2026-10.csv'}
def load(name):
    with (SOURCE / FILES[name]).open(encoding='utf-8-sig', newline='') as f:
        return [{k:v.strip() for k,v in row.items()} for row in csv.DictReader(f)]
def identifier(prefix, key): return prefix + '-' + hashlib.sha256(key.encode()).hexdigest()[:16]
def domain(url):
    return urllib.parse.urlparse(url if '://' in url else 'https://' + url).netloc.lower().removeprefix('www.')
def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',',':')), encoding='utf-8')
companies, investors, contacts, arr = [load(k) for k in FILES]
firm_by_url = {}
for r in investors:
    r['id'] = identifier('inv', r['lounge_url'].rstrip('/')); r['record_origin'] = 'investors'
    firm_by_url[r['lounge_url'].rstrip('/')] = r
for r in contacts:
    key = r['lounge_url'].rstrip('/')
    if key not in firm_by_url:
        firm = {'id':identifier('inv',key),'name':r['firm'],'type':r['firm_type'],'hq':r['firm_hq'],'website':r['firm_website'],'lounge_url':key,'record_origin':'contacts'}
        investors.append(firm); firm_by_url[key] = firm
    r['investor_id'] = firm_by_url[key]['id']
    r['id'] = identifier('person',key+'|'+r['name'].casefold()+'|'+r['email'].casefold())
contact_keys = {(r['investor_id'],r['name'].casefold()) for r in contacts}
for firm in investors:
    for n in range(1,4):
        name = firm.get(f'partner{n}_name','')
        if name and (firm['id'],name.casefold()) not in contact_keys:
            r = {'firm':firm['name'],'firm_type':firm['type'],'firm_hq':firm['hq'],'firm_website':firm['website'],'name':name,'title':firm.get(f'partner{n}_title',''),'email':firm.get(f'partner{n}_email',''),'linkedin':firm.get(f'partner{n}_linkedin',''),'email_status':'','lounge_url':firm['lounge_url'],'investor_id':firm['id'],'record_origin':'investor_partner'}
            r['id'] = identifier('person',firm['id']+'|'+name.casefold())
            contacts.append(r); contact_keys.add((firm['id'],name.casefold()))
deduplicated = {}
for r in contacts:
    if r['id'] not in deduplicated: deduplicated[r['id']] = r
    else:
        for key, value in r.items():
            if value and not deduplicated[r['id']].get(key): deduplicated[r['id']][key] = value
contacts = list(deduplicated.values())
counts = collections.Counter(r['investor_id'] for r in contacts)
for r in investors: r['contacts_count'] = str(counts[r['id']])
names = collections.defaultdict(list); domains = collections.defaultdict(list)
for r in companies:
    r['id'] = identifier('company',r['lounge_url'])
    names[r['name'].casefold()].append(r)
    if r['website']: domains[domain(r['website'])].append(r)
unmatched = []
for r in arr:
    matches = names[r['company'].casefold()]
    if len(matches) != 1: matches = domains[domain(r['website'])]
    if len(matches) == 1:
        r['company_id'] = matches[0]['id']
        matches[0]['arr_record_id'] = identifier('arr',r['company']+'|'+r['arr_as_of'])
    else: unmatched.append(r['company'])
    r['id'] = identifier('arr',r['company']+'|'+r['arr_as_of'])
# Compact indexes contain no email/phone; full records load only on detail views.
fields = {
 'companies':['name','country','industries','status','employees_est','arr_usd','revenue_usd','latest_stage'],
 'investors':['name','type','hq','ai_deals_2026','contacts_count','record_origin'],
 'contacts':['name','firm','title','firm_type','ai_focus','email_status','investor_id'],
 'arr':['rank','company','category','arr_usd','valuation_to_arr','arr_per_employee_usd','arr_kind','arr_as_of','company_id']}
manifest = {'snapshot':'2026-10','datasets':{},'unmatchedArrCompanies':unmatched,'sources':{k:{'file':v,'sha256':hashlib.sha256((SOURCE/v).read_bytes()).hexdigest()} for k,v in FILES.items()}}
for kind, rows in [('companies',companies),('investors',investors),('contacts',contacts),('arr',arr)]:
    if len({r['id'] for r in rows}) != len(rows): raise ValueError('Duplicate IDs: '+kind)
    index = []
    for offset in range(0,len(rows),100):
        chunk = offset // 100
        write(f'{kind}-{chunk}.json',rows[offset:offset+100])
        for r in rows[offset:offset+100]: index.append({'id':r['id'],'chunk':chunk,**{k:r.get(k,'') for k in fields[kind]}})
    write(f'{kind}-index.json',index)
    manifest['datasets'][kind] = {'count':len(rows),'chunks':(len(rows)+99)//100}
write('manifest.json',manifest)
print(json.dumps({'datasets':manifest['datasets'],'unmatchedArrCompanies':unmatched},ensure_ascii=False,indent=2))
