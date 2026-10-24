"""HTTP contract regression tests, including real source files from this folder."""
import base64
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "code"))
from backend.server import Handler


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.origin=f'http://127.0.0.1:{cls.http.server_port}'
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True)
        cls.thread.start()
        with urllib.request.urlopen(cls.origin+'/api/status') as response:
            cls.token=json.load(response)['token']

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join(timeout=3)

    def post(self, payload, origin=None, token=None):
        request=urllib.request.Request(self.origin+'/api/analyze',data=json.dumps(payload).encode(),
            headers={'Content-Type':'application/json','Origin':origin or self.origin,
                     'X-CodeLens-Token':token or self.token})
        with urllib.request.urlopen(request,timeout=30) as response:
            return json.load(response)

    def post_ai(self, payload, origin=None, token=None):
        request=urllib.request.Request(self.origin+'/api/ai',data=json.dumps(payload).encode(),
            headers={'Content-Type':'application/json','Origin':origin or self.origin,
                     'X-CodeLens-Token':token or self.token})
        with urllib.request.urlopen(request,timeout=60) as response:
            return json.load(response)

    def get_json(self, path):
        with urllib.request.urlopen(self.origin+path,timeout=30) as response:
            return json.load(response)

    def test_real_engine_and_server_sources(self):
        root=REPO_ROOT / 'code'
        paths=[root/'core_engine'/'engine.py',root/'backend'/'server.py']
        original={str(p.relative_to(root)):p.read_bytes() for p in paths}
        payload={'project':REPO_ROOT.name,'files':[{'path':p.relative_to(root).as_posix(),'content_base64':base64.b64encode(original[str(p.relative_to(root))]).decode()} for p in paths]}
        result=self.post(payload)
        self.assertEqual(result['status'],'complete')
        self.assertEqual(result['summary']['files'],2)
        self.assertGreater(result['summary']['functions'],10)
        self.assertTrue(any(f['name']=='analyze' for f in result['functions']))
        self.assertTrue(any(d['source']=='backend.server' and d['target']=='core_engine.engine' and d['internal'] for d in result['graph']['dependencies']))
        self.assertTrue(any(c['target']=='core_engine.engine.analyze' and c['status']=='resolved' for c in result['graph']['calls']))
        self.assertEqual(original,{str(p.relative_to(root)):p.read_bytes() for p in paths})
        print('\nREAL_SOURCE_RESULT '+json.dumps(result['summary'],ensure_ascii=True))

    def test_api_partial_error(self):
        r=self.post({'files':[{'path':'a.py','content':'pass'},{'path':'broken.py','content':'def ('}]})
        self.assertEqual(r['status'],'partial')

    def test_invalid_origin_blocked(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.post({'files':[]},origin='https://untrusted.invalid')
        self.assertEqual(ctx.exception.code,403)
        ctx.exception.close()

    def test_invalid_token_blocked(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.post({'files':[]},token='wrong')
        self.assertEqual(ctx.exception.code,403)
        ctx.exception.close()

    def test_static_allowlist(self):
        with urllib.request.urlopen(self.origin+'/') as response:
            self.assertIn('CodeLens',response.read().decode())
        for path in ['/engine.py','/../engine.py','/test_server.py']:
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(self.origin+path)
            self.assertEqual(ctx.exception.code,404)
            ctx.exception.close()

    def test_ai_status_lists_skills_and_limits(self):
        r=self.get_json('/api/ai/status')
        self.assertTrue(r['ready'])
        self.assertTrue(r['enabled'])
        self.assertTrue(r['template_only'])
        self.assertEqual([p['id'] for p in r['providers']][0],'builtin-template')
        ids=[s['id'] for s in r['skills']]
        self.assertEqual(ids,['logic-summary','class-node-name','ai-risk-review','solid-review'])
        self.assertEqual(r['limits']['max_targets'],24)
        self.assertTrue(all(s['version'] for s in r['skills']))

    def test_ai_results_carry_resolvable_citations(self):
        root=REPO_ROOT / 'code'
        path=root/'core_engine'/'ir.py'
        payload={'project':REPO_ROOT.name,'files':[{'path':'core_engine/ir.py',
            'content_base64':base64.b64encode(path.read_bytes()).decode()}],
            'skills':['logic-summary','ai-risk-review']}
        r=self.post_ai(payload)
        self.assertEqual(r['schema_version'],'1.0')
        self.assertTrue(r['results'])
        for item in r['results']:
            self.assertIn(item['status'],('ok','insufficient_evidence','need_more','refused'))
            self.assertEqual(item['generator']['provider'],'builtin-template')
            self.assertEqual(item['citations']['unresolved'],0)
            for claim in item['claims']:
                self.assertTrue(claim['evidence'])
                self.assertLessEqual(len(claim['text']),240)
        ok=[i for i in r['results'] if i['status']=='ok']
        self.assertTrue(ok,'至少应有一个 skill 给出带证据的结论')
        self.assertEqual(r['summary']['ok'],len(ok))
        print('\nAI_RESULT '+json.dumps(r['summary'],ensure_ascii=True))

    def test_ai_rejects_unregistered_skill(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.post_ai({'files':[{'path':'a.py','content':'pass'}],'skills':['nope']})
        self.assertEqual(ctx.exception.code,400)
        body=json.load(ctx.exception)
        self.assertEqual(body['error']['code'],'refused')
        ctx.exception.close()

    def test_ai_requires_token_like_analyze(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.post_ai({'files':[],'skills':['logic-summary']},token='wrong')
        self.assertEqual(ctx.exception.code,403)
        ctx.exception.close()

    def test_ai_on_empty_input_reports_no_source(self):
        r=self.post_ai({'files':[],'skills':['logic-summary']})
        self.assertEqual(r['results'],[])
        self.assertEqual(r['warnings'][0]['code'],'no-source')


if __name__=='__main__':
    unittest.main(verbosity=2)
