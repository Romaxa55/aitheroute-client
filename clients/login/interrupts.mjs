/**
 * The signals that end the helper through its cleanup, which closes the
 * browser and deletes its temporary profile.
 *
 * A closed terminal window is SIGHUP; on Windows, Node turns the console's
 * close into it. It can come twice - zsh hands it to its jobs, then the kernel
 * sends it again as the session leader dies - and a logout adds SIGTERM. These
 * stay heard until the cleanup is done: a second one with no listener would
 * kill the helper before the profile is gone. Ctrl+C is heard once, so a
 * second Ctrl+C still ends the helper at once.
 */
export const LASTING = ['SIGHUP', 'SIGTERM']

export const hearInterrupts = (interrupt) => {
  process.once('SIGINT', interrupt)
  for (const signal of LASTING) process.on(signal, interrupt)
  return {
    /** The cleanup starts: Ctrl+C is the user's again. */
    cleaning: () => process.removeListener('SIGINT', interrupt),
    /** The cleanup is done. */
    done: () => {
      for (const signal of LASTING) process.removeListener(signal, interrupt)
    },
  }
}
