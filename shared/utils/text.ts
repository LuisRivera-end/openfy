/** "1 canción", "2 canciones": Spanish count labels with the correct number. */
export function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

export const songCount = (count: number) => countLabel(count, 'canción', 'canciones')
