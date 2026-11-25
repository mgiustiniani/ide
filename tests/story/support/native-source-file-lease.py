"""Hold a real Linux file lease for a bounded acceptance fixture; never write source."""
import fcntl
import hashlib
import json
import os
import signal
import select
import stat
import sys


def emit(kind, **values):
    print(json.dumps({"kind": kind, **values}), flush=True)


def main():
    root, relative = sys.argv[1:]
    if not os.path.isabs(root) or os.path.realpath(root) != root:
        raise ValueError("noncanonical lease root")
    if not relative or relative != os.path.basename(relative) or relative in (".", ".."):
        raise ValueError("invalid lease fixture name")
    source = os.path.join(root, relative)
    if os.path.realpath(source) != source:
        raise ValueError("unsafe source fixture")
    descriptor = os.open(source, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    leased = False
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_size > 131072:
            raise ValueError("unsafe source fixture identity or size")
        observed = os.stat(source, follow_symlinks=False)
        if (observed.st_dev, observed.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError("source fixture changed during lease admission")

        break_requested = []

        def requested(_signal, _frame):
            break_requested.append(True)

        def expired(_signal, _frame):
            raise TimeoutError("source lease fixture deadline")

        signal.signal(signal.SIGIO, requested)
        signal.signal(signal.SIGALRM, expired)
        # Separate fixture bound, shorter than the kernel's normal lease-break timeout.
        with open("/proc/sys/fs/lease-break-time", encoding="ascii") as setting:
            if int(setting.read()) <= 12:
                raise ValueError("kernel lease-break budget is too short for this fixture")
        signal.alarm(12)
        fcntl.fcntl(descriptor, fcntl.F_SETLEASE, fcntl.F_WRLCK)
        leased = True
        digest = hashlib.sha256(os.read(descriptor, 131073)).hexdigest()
        emit("acquired", device=info.st_dev, inode=info.st_ino, originalSha256=digest)
        reported = False
        while True:
            if break_requested and not reported:
                emit("break-requested")
                reported = True
            if select.select([sys.stdin], [], [], 0.02)[0]:
                command = sys.stdin.readline()
                if command not in ("release\n", ""):
                    raise ValueError("invalid source lease release")
                break
    finally:
        if leased:
            fcntl.fcntl(descriptor, fcntl.F_SETLEASE, fcntl.F_UNLCK)
            emit("released")
        signal.alarm(0)
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # No source, paths, arbitrary OS messages or stack traces in fixture output.
        emit("failed", errorType=type(error).__name__)
        sys.exit(1)
