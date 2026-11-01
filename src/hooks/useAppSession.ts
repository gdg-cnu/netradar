import { useState } from "react"
import type { Page } from "../types/app"

/** Local demo session and navigation state; this does not authenticate a user. */
export function useAppSession() {
  const [loggedIn, setLoggedIn] = useState(true)
  const [page, setPage] = useState<Page>("map")

  function login() {
    setLoggedIn(true)
    setPage("map")
  }

  function logout() {
    setLoggedIn(false)
  }

  return { loggedIn, page, setPage, login, logout }
}
