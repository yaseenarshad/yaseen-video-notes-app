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
