# site_manager.py
import json
import os

DATA_DIR = 'data'
SITES_DB_FILE = os.path.join(DATA_DIR, 'sites.json')

def get_sites():
    if not os.path.exists(SITES_DB_FILE):
        return []
    try:
        with open(SITES_DB_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return []

def save_sites(sites):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SITES_DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(sites, f, ensure_ascii=False, indent=4)
