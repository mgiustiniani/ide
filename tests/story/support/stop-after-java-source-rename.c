#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Pause only the fixture's real rename, before it returns to the desktop. */
int renameat2(int old_dir, const char *old_path, int new_dir, const char *new_path,
              unsigned int flags) {
    int (*real_rename)(int, const char *, int, const char *, unsigned int) =
        dlsym(RTLD_NEXT, "renameat2");
    if (!real_rename) {
        errno = ENOSYS;
        return -1;
    }
    int result = real_rename(old_dir, old_path, new_dir, new_path, flags);
    int rename_errno = errno;
    const char *source = getenv("IDE_STORY_JAVA_RENAME_SOURCE");
    const char *destination = getenv("IDE_STORY_JAVA_RENAME_DESTINATION");
    const char *marker = getenv("IDE_STORY_JAVA_RENAME_MARKER");
    if (result == 0 && source && destination && marker &&
        strcmp(old_path, source) == 0 && strcmp(new_path, destination) == 0) {
        int fd = open(marker, O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC, 0600);
        if (fd >= 0) {
            dprintf(fd, "%ld\n", (long)getpid());
            close(fd);
            raise(SIGSTOP);
        }
    }
    errno = rename_errno;
    return result;
}
