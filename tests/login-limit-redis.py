import concurrent.futures
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path('.security-qa/python').resolve()))
import fakeredis

script = subprocess.check_output(
    ['node', '--input-type=module', '-e', "import { LOGIN_LIMIT_SCRIPT } from './server/login-limit.mjs'; process.stdout.write(LOGIN_LIMIT_SCRIPT)"],
    text=True,
)
clock = [2000000000.0]
client = fakeredis.FakeRedis(protocol=2)


def attempt(identity, ip='office', user='employee'):
    return client.eval(script, 2, 'ip:' + ip, 'user:' + user, 900000, 15, str(identity))


with patch('time.time', side_effect=lambda: clock[0]):
    for index in range(15):
        assert attempt(index) == [1, 0]
    assert attempt(16) == [0, 900000]
    assert attempt(17, ip='different') == [0, 900000]
    assert attempt(18, user='different') == [0, 900000]
    clock[0] += 899.999
    assert attempt(19)[0] == 0
    clock[0] += 0.002
    assert attempt(20) == [1, 0]
    client.flushall()
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(attempt, range(100)))
    assert sum(result[0] for result in results) == 15
    assert client.zcard('ip:office') == 15
    assert client.zcard('user:employee') == 15
print('Redis Lua verified: 15 allowed, 16th denied, IP/account isolation, expiry, 100 concurrent attempts admit only 15.')
