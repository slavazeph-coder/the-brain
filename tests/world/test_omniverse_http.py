"""Real worker/upload/job/signed-ZIP path, using explicitly synthetic scene geometry."""
import hashlib,json
from pathlib import Path
import sys,tempfile,time,unittest
from fastapi.testclient import TestClient
from robotics.world_worker.app import create_app
from test_omniverse_pack import fixture,dump
TOKEN='local-test-token-'+'x'*40
HEADERS={'Authorization':'Bearer '+TOKEN}
class HttpPackTests(unittest.TestCase):
    def test_authenticated_job_and_signed_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,workspace,options,cloud=fixture(root)
            adapter=Path(__file__).resolve().parents[2]/'robotics/world_worker/omniverse_pack.py'
            config=root/'adapters.json';dump(config,[{'id':'omniverse-pack','enabled':True,'license_reviewed':True,'input_kinds':['cloud'],'max_inputs':1,'source_job':True,'timeout_seconds':30,'command':[sys.executable,str(adapter),'--input-manifest','{input_manifest}','--workspace',str(workspace)]}])
            app=create_app(root=root/'worker',token=TOKEN,adapters=str(config))
            with TestClient(app) as c:
                self.assertEqual(c.get('/v1/capabilities').status_code,401)
                self.assertIn('simready_assets',c.get('/v1/capabilities',headers=HEADERS).json())
                store=app.state.store;source_id='a'*32;parent=store.root/'jobs'/source_id;parent.mkdir();source.rename(parent/'output')
                store.db.execute('INSERT INTO jobs(id,engine,status,uploads,created,error,artifacts,owner_id) VALUES(?,?,?,?,?,?,?,?)',(source_id,'scene-usd','complete','[]',time.time(),None,'[]','operator'));store.db.commit()
                body=json.dumps({**cloud,'omniversePack':options}).encode()
                r=c.post('/v1/uploads',json={'name':'request.json','kind':'cloud','size':len(body)},headers=HEADERS);self.assertEqual(r.status_code,201,r.text);uid=r.json()['id']
                r=c.put(f'/v1/uploads/{uid}?offset=0',content=body,headers=HEADERS);self.assertEqual(r.status_code,200,r.text)
                r=c.post('/v1/jobs',json={'engine':'omniverse-pack','upload_ids':[uid],'source_job':source_id,'consent':True},headers=HEADERS);self.assertEqual(r.status_code,201,r.text);jid=r.json()['id']
                self.assertEqual(c.post(f'/v1/jobs/{jid}/start',headers=HEADERS).status_code,200)
                for _ in range(150):
                    job=c.get('/v1/jobs/'+jid,headers=HEADERS).json()
                    if job['status'] in ('complete','failed','cancelled'):break
                    time.sleep(.05)
                self.assertEqual(job['status'],'complete',job)
                entry=next((i,a) for i,a in enumerate(job['artifacts']) if a['name']=='scene-omniverse.zip')
                ticket=c.post(f'/v1/jobs/{jid}/ticket',json={'artifact':entry[0]},headers=HEADERS);self.assertEqual(ticket.status_code,200,ticket.text)
                result=c.get(ticket.json()['url']);self.assertEqual(result.status_code,200);self.assertEqual(hashlib.sha256(result.content).hexdigest(),entry[1]['sha256'])
                self.assertEqual(c.get('/v1/jobs/'+jid,headers={'Authorization':'Bearer wrong'}).status_code,401)
if __name__=='__main__':unittest.main()
