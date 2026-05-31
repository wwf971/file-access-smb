import { useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { observer } from 'mobx-react-lite'
import { SpinningCircle } from '@wwf971/react-comp-misc'
import { fapSmbExternalStore } from '../store/fapSmbExternalStore'

const MARKDOWN_COMPONENTS = {
  h1: ({ children }: any) => <div className="txt-editor-md-title txt-editor-md-title-level-1">{children}</div>,
  h2: ({ children }: any) => <div className="txt-editor-md-title txt-editor-md-title-level-2">{children}</div>,
  h3: ({ children }: any) => <div className="txt-editor-md-title txt-editor-md-title-level-3">{children}</div>,
  h4: ({ children }: any) => <div className="txt-editor-md-title txt-editor-md-title-level-4">{children}</div>,
  h5: ({ children }: any) => <div className="txt-editor-md-title txt-editor-md-title-level-5">{children}</div>,
  h6: ({ children }: any) => <div className="txt-editor-md-title txt-editor-md-title-level-6">{children}</div>,
  p: ({ children }: any) => <div className="txt-editor-md-block">{children}</div>,
  ul: ({ children }: any) => <div className="txt-editor-md-list">{children}</div>,
  ol: ({ children }: any) => <div className="txt-editor-md-list">{children}</div>,
  li: ({ children }: any) => <div className="txt-editor-md-list-item">{children}</div>,
  blockquote: ({ children }: any) => <div className="txt-editor-md-quote">{children}</div>,
  pre: ({ children }: any) => <div className="txt-editor-md-pre">{children}</div>,
  code: ({ children }: any) => <span className="txt-editor-md-code">{children}</span>,
  a: ({ href, children }: any) => (
    <a className="txt-editor-md-link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  strong: ({ children }: any) => <span className="txt-editor-md-strong">{children}</span>,
  em: ({ children }: any) => <span className="txt-editor-md-em">{children}</span>,
}

const FapSmbExternalEditorTxt = observer(() => {
  const isOpen = fapSmbExternalStore.isTextEditorOpen
  const isBusy = fapSmbExternalStore.isTextEditorLoading || fapSmbExternalStore.isTextEditorSaving

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        fapSmbExternalStore.requestSaveTextEditor()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div className="txt-editor-overlay">
      <div className="txt-editor-popup">
        <div className="txt-editor-top-row">
          <div className="txt-editor-title-wrap">
            <div className="txt-editor-title">{fapSmbExternalStore.textEditorPath}</div>
            <div className="txt-editor-subtitle">
              {fapSmbExternalStore.isTextEditorDirty ? 'modified' : 'saved'}
              {fapSmbExternalStore.textEditorBackupPath ? ` | backup: ${fapSmbExternalStore.textEditorBackupPath}` : ''}
            </div>
          </div>
          <div className="txt-editor-action-row">
            {fapSmbExternalStore.isTextEditorMarkdown ? (
              <button
                type="button"
                className="main-btn"
                disabled={isBusy}
                onClick={() => {
                  fapSmbExternalStore.toggleMarkdownPreview()
                }}
              >
                {fapSmbExternalStore.isMarkdownPreviewVisible ? 'hide preview' : 'show preview'}
              </button>
            ) : null}
            <button
              type="button"
              className="main-btn"
              disabled={isBusy}
              onClick={() => {
                fapSmbExternalStore.requestSaveTextEditor()
              }}
            >
              save
            </button>
            <button
              type="button"
              className="main-btn"
              disabled={isBusy}
              onClick={() => {
                fapSmbExternalStore.closeTextEditor()
              }}
            >
              close
            </button>
          </div>
        </div>
        {fapSmbExternalStore.textEditorStatusText || fapSmbExternalStore.textEditorErrorText ? (
          <div className={`txt-editor-message ${fapSmbExternalStore.textEditorErrorText ? 'status-error' : 'status-info'}`}>
            {isBusy ? <SpinningCircle width={12} height={12} /> : null}
            <div>
              {fapSmbExternalStore.textEditorErrorText || fapSmbExternalStore.textEditorStatusText}
              {fapSmbExternalStore.isTextEditorDecodeLossy ? ' | some bytes could not be decoded as utf-8' : ''}
            </div>
          </div>
        ) : null}
        <div className={`txt-editor-body ${fapSmbExternalStore.isMarkdownPreviewVisible ? 'has-preview' : ''}`}>
          <textarea
            className="txt-editor-input"
            value={fapSmbExternalStore.textEditorContent}
            spellCheck={false}
            disabled={isBusy}
            onChange={(event) => {
              fapSmbExternalStore.setTextEditorContent(event.target.value)
            }}
          />
          {fapSmbExternalStore.isMarkdownPreviewVisible ? (
            <div className="txt-editor-preview">
              <ReactMarkdown components={MARKDOWN_COMPONENTS}>
                {fapSmbExternalStore.textEditorContent}
              </ReactMarkdown>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
})

export default FapSmbExternalEditorTxt
