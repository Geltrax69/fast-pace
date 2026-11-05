import { Game } from './game'

const game = new Game()
game.init().catch((err) => {
  console.error(err)
  const el = document.getElementById('loading')
  if (el) el.textContent = `Failed to load: ${String(err)}`
})
