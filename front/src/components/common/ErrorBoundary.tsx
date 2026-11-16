import { Component, type ErrorInfo, type ReactNode } from 'react'

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Do not log user data or tokens. */
  }
  render() {
    if (this.state.failed)
      return (
        <main className="app-loading">
          <div>
            <h1>화면을 불러오지 못했습니다.</h1>
            <p>연결을 확인한 뒤 다시 시도해 주세요.</p>
            <button className="primary-button" onClick={() => window.location.reload()}>
              새로고침
            </button>
          </div>
        </main>
      )
    return this.props.children
  }
}
