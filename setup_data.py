"""First-time setup: python setup_data.py (after installing requirements.txt)."""
import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--espn-only', action='store_true', help='Skip Sleeper; requires existing Sleeper data to rebuild combined reports.')
    parser.add_argument('--league-id', type=int, default=1706900528)
    parser.add_argument('--season', type=int, default=2024)
    args = parser.parse_args()
    os.chdir(Path(__file__).resolve().parent)
    from fetch_espn_details import credentials
    path = Path('espn_secrets.json')
    try:
        credentials(path)
    except SystemExit:
        print('Enter your own ESPN cookies. Input is hidden and saved only locally.')
        s2 = getpass.getpass('espn_s2: ').strip()
        swid = getpass.getpass('SWID (including braces): ').strip()
        if not s2 or not swid:
            raise SystemExit('Both cookies are required; no data was fetched.')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as file:
            json.dump({'espn_s2': s2, 'SWID': swid}, file)
        os.chmod(path, 0o600)
        credentials(path)
    if not args.espn_only:
        subprocess.run([sys.executable, 'fetch_sleeper_history.py'], check=True)
    subprocess.run([sys.executable, 'fetch_espn_details.py', '--league-id', str(args.league_id), '--season', str(args.season)], check=True)
    print('Data and reports ready. Run: python -m http.server 8000 --bind 127.0.0.1')


if __name__ == '__main__':
    main()
