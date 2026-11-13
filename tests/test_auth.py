import http.client
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location('ridex_server', Path(__file__).resolve().parents[1] / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class AuthTest(unittest.TestCase):
    def test_full_flow(self):
        with tempfile.TemporaryDirectory() as folder:
            server.DB = Path(folder) / 'data' / 'test.sqlite3'
            app = server.make_server(0)
            thread = threading.Thread(target=app.serve_forever, daemon=True)
            thread.start()
            port = app.server_port
            cookie = ''

            def request(path, fields=None, origin=True):
                nonlocal cookie
                client = http.client.HTTPConnection('127.0.0.1', port)
                headers = {'Cookie': cookie}
                if origin:
                    headers['Origin'] = f'http://127.0.0.1:{port}'
                if fields is not None:
                    headers['Content-Type'] = 'application/json'
                client.request('POST' if fields is not None else 'GET', path,
                               json.dumps(fields) if fields is not None else None, headers)
                response = client.getresponse()
                if response.getheader('Set-Cookie'):
                    cookie = response.getheader('Set-Cookie').split(';')[0]
                status, body = response.status, response.read()
                client.close()
                return status, body

            user = dict(name='<Alice>', email='Alice@example.com', password='secret123', confirm='secret123')
            try:
                self.assertEqual(request('/api/me')[0], 200)
                self.assertEqual(request('/api/register', user, origin=False)[0], 403)
                self.assertEqual(request('/api/register', dict(user, confirm='different'))[0], 400)
                self.assertEqual(request('/api/register', user)[0], 200)
                self.assertEqual(json.loads(request('/api/me')[1])['user']['name'], '<Alice>')
                self.assertEqual(request('/api/register', user)[0], 409)
                with server.connect() as db:
                    stored = db.execute('SELECT password_hash FROM users').fetchone()[0]
                    self.assertNotEqual(stored, user['password'])
                server.initialize()  # Existing database survives initialization on restart.
                self.assertIsNotNone(json.loads(request('/api/me')[1])['user'])
                self.assertEqual(request('/api/logout', {})[0], 200)
                self.assertIsNone(json.loads(request('/api/me')[1])['user'])
                self.assertEqual(request('/api/login', dict(user, password='wrong123'))[0], 401)
                self.assertEqual(request('/api/login', dict(user, email='ALICE@EXAMPLE.COM'))[0], 200)
                for path in ('/data/ridex.sqlite3', '/server.py', '/runtime/python.exe', '/html/../server.py', '/%2e%2e/server.py'):
                    self.assertEqual(request(path)[0], 404)
                for path in ('/', '/html/account.html', '/js/app.js', '/css/style.css'):
                    self.assertEqual(request(path)[0], 200)
                with server.connect() as db:
                    db.execute('UPDATE sessions SET expires=0')
                self.assertIsNone(json.loads(request('/api/me')[1])['user'])
                app.attempts = [__import__('time').time()] * 15
                self.assertEqual(request('/api/login', user)[0], 429)
            finally:
                app.shutdown()
                app.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
