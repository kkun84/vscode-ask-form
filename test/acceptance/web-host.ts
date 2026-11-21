export const run = async (): Promise<void> => {
  for (;;) {
    await new Promise((resolve) => {
      setTimeout(resolve, 60_000)
    })
  }
}
