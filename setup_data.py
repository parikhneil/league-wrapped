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
    parser.add_argument('--skip-nfl', action='store_true', help='Skip the public NFL expected-points model download.')
    parser.add_argument('--skip-comebacks', action='store_true', help='Skip public NFL historical game-day comeback reconstruction.')
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
    if not args.skip_nfl:
        result = subprocess.run([sys.executable, 'fetch_nfl_opportunity.py', '--no-build'], check=False)
        if result.returncode:
            print('NFL opportunity refresh unavailable; building with existing data and coverage indicators.')
    if not args.skip_comebacks:
        result = subprocess.run([sys.executable, 'fetch_comeback_history.py', '--no-build'], check=False)
        if result.returncode:
            print('Historical comeback reconstruction unavailable; building with existing history and coverage indicators.')
    # Always rebuild after all selected importers, including when optional NFL
    # downloads are skipped or an upstream source is unavailable.
    subprocess.run([sys.executable, 'build_report.py'], check=True)
    print('Data and reports ready. With Node 20 or newer, run: npm ci && npm start')
    print('Open the address printed by the server. For chat, set your own GROQ_API_KEY in the ignored local .env file.')
    print('For Netlify, push the generated reports and snapshots, then use npm run build with dist as the publish directory.')
    print('Set GROQ_API_KEY in Netlify environment variables with Functions scope and redeploy; see README.md for setup and privacy details.')


if __name__ == '__main__':
    main()
