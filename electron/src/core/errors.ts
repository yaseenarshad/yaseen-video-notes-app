/** An error whose message is shown to the user as it is (Swift `FollowAlongError`). */
export class FollowAlongError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FollowAlongError'
  }
  toString(): string {
    return this.message
  }
}

/** A failure of yt-dlp itself (it could not run, exited with an error, or wrote nothing): an update may fix it. */
export class YTDLPError extends FollowAlongError {
  constructor(message: string) {
    super(message)
    this.name = 'YTDLPError'
  }
}
