import os
import shlex
import subprocess
from typing import Dict, List, Optional


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MASTER_SCRIPT = os.path.join(BASE_DIR, 'scripts', 'usb_master_sync.sh')
DEFAULT_LABEL = os.environ.get('USB_SYNC_LABEL', 'TOOLMASTER')


def _resolve_docviewer_script() -> Optional[str]:
    """Return the DocumentViewer USB import script path if available."""
    candidates: List[str] = []

    env_path = os.environ.get('DOCVIEWER_IMPORT_SCRIPT')
    if env_path:
        candidates.append(env_path)

    candidates.append(os.path.join(os.path.dirname(BASE_DIR), 'DocumentViewer', 'scripts', 'usb-import.sh'))
    candidates.append('/home/tools01/DocumentViewer/scripts/usb-import.sh')
    candidates.append('/home/pi/DocumentViewer/scripts/usb-import.sh')

    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def _run_command(name: str, cmd: List[str]) -> Dict[str, str]:
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return {
        'name': name,
        'command': ' '.join(shlex.quote(part) for part in cmd),
        'returncode': proc.returncode,
        'stdout': proc.stdout,
        'stderr': proc.stderr,
    }


def _detect_device_by_label(label: str) -> Optional[str]:
    if not label:
        return None

    label_path = os.path.join('/dev/disk/by-label', label)
    if os.path.exists(label_path):
        resolved = os.path.realpath(label_path)
        if os.path.exists(resolved):
            return resolved
        return label_path

    try:
        lsblk = subprocess.run(
            ['lsblk', '-lnp', '-o', 'PATH,LABEL'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
    except Exception:
        return None

    for line in lsblk.stdout.splitlines():
        parts = line.strip().split()
        if len(parts) != 2:
            continue
        path, found_label = parts
        if found_label == label and os.path.exists(path):
            return path
    return None


def _resolve_device(initial: Optional[str]) -> str:
    candidates: List[str] = []

    env_device = os.environ.get('USB_SYNC_DEVICE')
    if env_device:
        candidates.append(env_device)

    if initial:
        candidates.append(initial)

    label_device = _detect_device_by_label(DEFAULT_LABEL)
    if label_device:
        candidates.append(label_device)

    # Fallback: try /dev/sdb1 if /dev/sda1 not available (common on RPi with SSD)
    candidates.append('/dev/sdb1')

    for candidate in candidates:
        if not candidate:
            continue
        if os.path.islink(candidate):
            real_path = os.path.realpath(candidate)
            if os.path.exists(real_path):
                return real_path
        if os.path.exists(candidate):
            return candidate

    raise FileNotFoundError(
        f"USB デバイスが見つかりません。環境変数 USB_SYNC_DEVICE でデバイスパスを指定するか、"
        f"{DEFAULT_LABEL} ラベル付きの USB を接続してください。"
    )


def run_usb_sync(device: str = '/dev/sda1') -> Dict[str, object]:
    steps: List[Dict[str, str]] = []
    combined_stdout: List[str] = []
    combined_stderr: List[str] = []
    overall_code = 0

    if not os.path.isfile(MASTER_SCRIPT):
        raise FileNotFoundError(f'マスター同期スクリプトが見つかりません: {MASTER_SCRIPT}')

    try:
        resolved_device = _resolve_device(device)
    except FileNotFoundError as err:
        return {
            'returncode': 1,
            'steps': steps + [{
                'name': 'tool_master',
                'title': '工具マスタ同期',
                'command': '',
                'returncode': 1,
                'stdout': '',
                'stderr': str(err),
            }],
            'stdout': '',
            'stderr': str(err),
        }

    commands: List[Dict[str, object]] = [
        {
            'name': 'tool_master',
            'cmd': ['sudo', 'bash', MASTER_SCRIPT, resolved_device],
            'title': '工具マスタ同期',
        }
    ]

    docviewer_script = _resolve_docviewer_script()
    if docviewer_script:
        commands.append(
            {
                'name': 'docviewer',
                'cmd': ['sudo', 'bash', docviewer_script, resolved_device],
                'title': 'ドキュメントビューア同期',
            }
        )
    else:
        steps.append({
            'name': 'docviewer',
            'title': 'ドキュメントビューア同期',
            'command': '',
            'returncode': 127,
            'stdout': '',
            'stderr': 'DocumentViewer の USB インポートスクリプトが見つかりません。DOCVIEWER_IMPORT_SCRIPT を設定してください。',
        })
        overall_code = 127

    for command in commands:
        step = _run_command(command['name'], command['cmd'])
        step['title'] = command['title']
        steps.append(step)

        if step['stdout']:
            combined_stdout.append(f"== {command['title']} ==\n{step['stdout'].strip()}\n")
        if step['stderr']:
            combined_stderr.append(f"== {command['title']} ==\n{step['stderr'].strip()}\n")
        if step['returncode'] != 0:
            overall_code = overall_code or int(step['returncode'])

    result = {
        'returncode': overall_code,
        'steps': steps,
        'stdout': '\n'.join(line for line in combined_stdout if line).strip(),
        'stderr': '\n'.join(line for line in combined_stderr if line).strip(),
    }

    return result
