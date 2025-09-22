import os
import subprocess


def run_usb_sync(device='/dev/sda1'):
    script = os.path.join(os.path.dirname(__file__), 'scripts', 'usb_master_sync.sh')
    cmd = ["sudo", "bash", script, device]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return proc.returncode, proc.stdout, proc.stderr
