from pathlib import Path
import argparse,hashlib,json,subprocess,sys
import yaml
p=argparse.ArgumentParser();p.add_argument('reports');p.add_argument('--output',required=True);p.add_argument('--collection',default='postman/ci/CareX-CI-Contract.postman_collection.json');p.add_argument('--rehearsal',action='store_true');a=p.parse_args()
try:
 files=list(Path(a.reports).glob('*.collection-run-summary.yaml'))
 assert len(files)==1,'Exactly one native summary must exist'
 j=yaml.safe_load(files[0].read_text());s=j['stats']
 assert j['kind']=='postman-cli-collection-run-summary' and j['schemaVersion']==1,'Unknown report format'
 assert j['state']=='completed','Native report is not completed'
 assert j['simulation'] is None,'Simulated runs are not accepted'
 assert j['executionsRecorded']==4 and s['executedRequests']=={'executed':4,'errors':0},'Expected four real requests without request errors'
 assert s['tests']=={'executed':6,'failed':0},'All six mandatory assertions must execute and pass'
 assert s['prerequestScripts']=={'executed':4,'errors':0},'Pre-request scripts must pass'
 assert s['postresponseScripts']=={'executed':4,'errors':0},'Response scripts must pass'
 assert not j['failures'],'Native failures are present'
 collection=Path(a.collection);expected=json.loads(collection.read_text())['info']['_postman_id']
 assert j['meta']['collection']['id']==expected,'Report belongs to a different collection'
 assert j['environment']['cli']['version']=='1.93.0','Unexpected CLI version'
 commit=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
 assert j['environment']['git']['commit']==commit,'Report belongs to a different source commit'
 dirty=bool(subprocess.check_output(['git','status','--porcelain'],text=True).strip())
 if not a.rehearsal:assert not dirty,'Delivery requires a clean committed source tree'
 result={'gate':'passed','rehearsalOnly':a.rehearsal,'runId':j['runId'],'sourceCommit':commit,'requests':4,'assertions':6,'failedAssertions':0,'coverage':'read-only contract smoke only','productionDeploymentApproved':False,'collectionSha256':hashlib.sha256(collection.read_bytes()).hexdigest(),'nativeSummarySha256':hashlib.sha256(files[0].read_bytes()).hexdigest()}
 Path(a.output).parent.mkdir(parents=True,exist_ok=True);Path(a.output).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
except (AssertionError,KeyError,TypeError,ValueError) as e:
 print('EVIDENCE GATE FAILED: '+str(e),file=sys.stderr);raise SystemExit(1)
