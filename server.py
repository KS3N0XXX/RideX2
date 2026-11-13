"""Local RideX server. Standard library only; Windows portable runtime included."""
from contextlib import contextmanager
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
import webbrowser
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'data' / 'ridex.sqlite3'
ROUNDS = 600_000


@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=10)
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize():
    DB.parent.mkdir(exist_ok=True)
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
          salt TEXT NOT NULL, password_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
        ''')


def digest(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), ROUNDS).hex()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def allowed_host(self):
        return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'

    def reply(self, status, data, cookie=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def session_token(self):
        try:
            cookies = SimpleCookie(self.headers.get('Cookie', ''))
            value = cookies.get('ridex_session')
            return hashlib.sha256(value.value.encode()).hexdigest() if value else ''
        except Exception:
            return ''

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        if not self.allowed_host():
            return self.reply(403, {'error': 'Недопустимый адрес.'})
        path = urlsplit(self.path).path
        if path == '/api/me':
            with connect() as db:
                row = db.execute('''SELECT users.id, name, email FROM users JOIN sessions
                  ON users.id=sessions.user_id WHERE token=? AND expires>?''',
                  (self.session_token(), int(time.time()))).fetchone()
            return self.reply(200, {'user': dict(zip(('id', 'name', 'email'), row)) if row else None})
        # Serve only public assets, never database, runtime or backend files.
        target = (ROOT / unquote(path).lstrip('/')).resolve()
        try:
            relative = target.relative_to(ROOT)
        except ValueError:
            return self.send_error(404)
        parts = relative.parts
        allowed = (relative.as_posix() == 'index.html' or
                   (parts and parts[0] in ('html', 'css', 'js', 'images') and
                    target.suffix.lower() in ('.html', '.css', '.js', '.svg', '.webp', '.png', '.jpg')))
        if path == '/':
            self.path = '/index.html'
        elif not allowed or not target.is_file():
            return self.send_error(404)
        if head:
            return super().do_HEAD()
        return super().do_GET()

    def do_POST(self):
        origin = f'http://127.0.0.1:{self.server.server_port}'
        if not self.allowed_host() or self.headers.get('Origin') != origin:
            return self.reply(403, {'error': 'Запрос запрещён.'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reply(415, {'error': 'Ожидается JSON.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8192:
                raise ValueError()
            self.connection.settimeout(5)
            fields = json.loads(self.rfile.read(size))
            if not isinstance(fields, dict):
                raise ValueError()
        except (ValueError, OSError):
            return self.reply(400, {'error': 'Некорректный запрос.'})
        path = urlsplit(self.path).path
        if path == '/api/logout':
            with connect() as db:
                db.execute('DELETE FROM sessions WHERE token=?', (self.session_token(),))
            return self.reply(200, {'ok': True}, 'ridex_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
        if path not in ('/api/register', '/api/login'):
            return self.reply(404, {'error': 'Не найдено.'})
        now = time.time()
        # shortcut: one shared local limit; use per-user limits before public deployment.
        self.server.attempts[:] = [stamp for stamp in self.server.attempts if stamp > now - 60]
        if len(self.server.attempts) >= 15:
            return self.reply(429, {'error': 'Слишком много попыток. Подожди минуту.'})
        self.server.attempts.append(now)
        email = fields.get('email', '')
        password = fields.get('password', '')
        if not isinstance(email, str) or not isinstance(password, str):
            return self.reply(400, {'error': 'Проверь почту и пароль.'})
        email = email.strip().lower()
        if len(email) > 120 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email) or not 8 <= len(password) <= 128:
            return self.reply(400, {'error': 'Укажи корректную почту и пароль от 8 до 128 символов.'})
        with connect() as db:
            if path == '/api/register':
                name = fields.get('name', '')
                if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
                    return self.reply(400, {'error': 'Укажи имя от 1 до 60 символов.'})
                if fields.get('confirm') != password:
                    return self.reply(400, {'error': 'Пароли не совпадают.'})
                salt = secrets.token_hex(16)
                try:
                    cursor = db.execute('INSERT INTO users(name,email,salt,password_hash) VALUES(?,?,?,?)',
                                        (name.strip(), email, salt, digest(password, salt)))
                except sqlite3.IntegrityError:
                    return self.reply(409, {'error': 'Эта почта уже зарегистрирована.'})
                user_id = cursor.lastrowid
            else:
                row = db.execute('SELECT id,salt,password_hash FROM users WHERE email=?', (email,)).fetchone()
                candidate = digest(password, row[1] if row else '00' * 16)
                if not row or not hmac.compare_digest(candidate, row[2]):
                    return self.reply(401, {'error': 'Неверная почта или пароль.'})
                user_id = row[0]
            token = secrets.token_urlsafe(32)
            db.execute('DELETE FROM sessions WHERE expires<=? OR token=?', (int(now), self.session_token()))
            db.execute('INSERT INTO sessions VALUES(?,?,?)',
                       (hashlib.sha256(token.encode()).hexdigest(), user_id, int(now) + 604800))
        self.reply(200, {'ok': True}, f'ridex_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800')


def make_server(port=8765):
    initialize()
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.attempts = []
    return server


if __name__ == '__main__':
    try:
        server = make_server()
    except OSError as error:
        print('Cannot start RideX. Close the other RideX window and try again.\n', error)
        raise SystemExit(1)
    url = 'http://127.0.0.1:8765'
    print(f'RideX: {url}\nKeep this window open. Press Ctrl+C to stop.')
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
