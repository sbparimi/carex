from time import monotonic,sleep
from urllib.request import urlopen
from urllib.error import URLError,HTTPError
import json,sys
end=monotonic()+60
while monotonic()<end:
    try:
        with urlopen('http://127.0.0.1:8130/t/northwind-health/api/v1/health',timeout=3) as r:
            j=json.load(r)
            if r.status==200 and j=={'status':'ok','tenant':'northwind-health','api_version':'v1'}:
                print('The real Neon-backed course API is ready.')
                raise SystemExit(0)
    except (URLError,HTTPError,ValueError):
        pass
    sleep(.25)
print('The course API did not become ready. No Postman run or candidate delivery is allowed.',file=sys.stderr)
raise SystemExit(1)
