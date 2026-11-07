"""Real loopback model + application HTTP contract for natural explanations."""
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from backend.server import Handler


class ModelHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        self.server.requests.append((self.path, json.loads(self.rfile.read(int(self.headers['Content-Length']))),
                                     self.headers.get('Authorization')))
        self.send_response(self.server.status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(self.server.response).encode())


class ExplanationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.model = ThreadingHTTPServer(('127.0.0.1', 0), ModelHandler)
        cls.threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in (cls.app, cls.model)]
        for t in cls.threads:
            t.start()
        cls.origin = f'http://127.0.0.1:{cls.app.server_port}'
        with urllib.request.urlopen(cls.origin + '/api/status') as response:
            cls.token = json.load(response)['token']

    @classmethod
    def tearDownClass(cls):
        for server in (cls.app, cls.model):
            server.shutdown()
            server.server_close()
        for t in cls.threads:
            t.join(timeout=3)

    def setUp(self):
        self.model.requests = []
        self.model.status = 200
        self.model.response = {'choices': [{'message': {'content': '先检查输入，再返回计算结果（第 2–3 行）。'}, 'finish_reason': 'stop'}]}
        self.payload = {'project': 'demo', 'files': [{'path': 'a.py', 'content': 'def f(x):\n    if x:\n        return x + 1\n\ndef unrelated():\n    return "UNRELATED_SOURCE"\n'}],
                        'target': {'file': 'a.py', 'function': 'a.f'},
                        'provider': {'base_url': f'http://127.0.0.1:{self.model.server_port}/v1', 'model': 'test-model', 'api_key': 'private-test-key'}}

    def post(self, payload=None, token=None):
        request = urllib.request.Request(self.origin + '/api/explain', data=json.dumps(self.payload if payload is None else payload).encode(),
                                         headers={'Content-Type': 'application/json', 'Origin': self.origin,
                                                  'X-CodeLens-Token': token or self.token})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, json.load(exc)

    def test_function_scope_and_key_are_handled_by_backend(self):
        status, data = self.post()
        self.assertEqual(status, 200)
        self.assertIn('先检查输入', data['text'])
        path, request, auth = self.model.requests[0]
        self.assertEqual(path, '/v1/chat/completions')
        self.assertEqual(auth, 'Bearer private-test-key')
        self.assertNotIn('UNRELATED_SOURCE', request['messages'][1]['content'])
        self.assertIn('2:     if x:', request['messages'][1]['content'])
        self.assertNotIn('private-test-key', json.dumps(data))
        self.assertEqual((data['line'], data['end_line']), (1, 3))

    def test_whole_file_scope(self):
        self.payload['target']['function'] = None
        self.assertEqual(self.post()[0], 200)
        self.assertIn('UNRELATED_SOURCE', self.model.requests[0][1]['messages'][1]['content'])

    def test_full_endpoint_does_not_duplicate_suffix(self):
        self.payload['provider']['base_url'] += '/chat/completions/'
        self.assertEqual(self.post()[0], 200)
        self.assertEqual(self.model.requests[0][0], '/v1/chat/completions')

    def test_wrong_token_blocks_model_call(self):
        self.assertEqual(self.post(token='wrong')[0], 403)
        self.assertFalse(self.model.requests)

    def test_invalid_target_blocks_model_call(self):
        self.payload['target']['function'] = 'missing.f'
        self.assertEqual(self.post()[0], 400)
        self.assertFalse(self.model.requests)

    def test_incomplete_config_blocks_model_call(self):
        self.payload['provider']['model'] = ''
        self.assertEqual(self.post()[0], 400)
        self.assertFalse(self.model.requests)

    def test_provider_error_does_not_leak_body_or_key(self):
        self.model.status = 401
        self.model.response = {'error': 'private-test-key'}
        status, data = self.post()
        self.assertEqual(status, 502)
        self.assertIn('401', data['error'])
        self.assertNotIn('private-test-key', json.dumps(data))

    def test_empty_model_output_is_failure_not_template(self):
        self.model.response['choices'][0]['message']['content'] = ''
        status, data = self.post()
        self.assertEqual(status, 502)
        self.assertNotIn('text', data)

    def test_truncated_model_response_is_marked(self):
        self.model.response['choices'][0]['finish_reason'] = 'length'
        self.assertTrue(self.post()[1]['truncated'])

    def test_large_source_is_rejected_before_model_request(self):
        self.payload['target']['function'] = None
        self.payload['files'][0]['content'] = 'value = "' + 'x' * 60000 + '"'
        self.assertEqual(self.post()[0], 400)
        self.assertFalse(self.model.requests)
