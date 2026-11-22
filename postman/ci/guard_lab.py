"""Fail before opening a database when the disposable lab target is not exact."""
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlsplit
import hashlib,json,os,sys

def validate(value,config,now=None):
    if not value:
        raise ValueError('The dedicated encrypted course lab secret is missing. Tests must not be skipped.')
    u=urlsplit(value)
    if u.scheme not in ('postgres','postgresql') or not u.hostname or not u.hostname.endswith('.neon.tech'):
        raise ValueError('The lab must use its verified Neon endpoint.')
    if hashlib.sha256(u.hostname.encode()).hexdigest()!=config['hostnameSha256']:
        raise ValueError('The database endpoint does not match the verified disposable lab. No database was opened.')
    if not u.username or not u.password or u.path!='/carex_course_dev':
        raise ValueError('The dedicated course connection is incomplete or names another database.')
    if (now or datetime.now(timezone.utc))>=datetime.fromisoformat(config['expiresAt']):
        raise ValueError('The disposable branch expired. Create and verify a new isolated lab before updating its binding.')
    return {'guard':'passed','target':'verified disposable Neon lab','databaseOpened':False}

if __name__=='__main__':
    try:
        config=json.loads(Path('postman/ci/lab.json').read_text())
        print(json.dumps(validate(os.environ.get('DATABASE_URL',''),config)))
    except (ValueError,KeyError,TypeError) as e:
        print('LAB GUARD FAILED: '+str(e),file=sys.stderr)
        raise SystemExit(1)
