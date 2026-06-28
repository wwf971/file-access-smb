import ReactMarkdown from 'react-markdown'
import { SpinningCircle } from '@wwf971/react-comp-misc'
import './SmbMarkdownTextEditor.css'

export type SmbMarkdownTextEditorMessageState = {
  status: 'idle' | 'loading' | 'success' | 'error' | 'info'
  messageText: string
}

export type SmbMarkdownTextEditorData = {
  titleText?: string
  subtitleText?: string
  contentText: string
  messageState?: SmbMarkdownTextEditorMessageState
}

export type SmbMarkdownTextEditorConfig = {
  isReadOnly?: boolean
  isBusy?: boolean
  isMarkdown?: boolean
  isPreviewVisible?: boolean
  isSaveVisible?: boolean
  isCloseVisible?: boolean
  isDismissVisible?: boolean
  emptyMessageText?: string
  height?: number | string
}

export type SmbMarkdownTextEditorProps = {
  data: SmbMarkdownTextEditorData
  config?: SmbMarkdownTextEditorConfig
  onEvent?: (eventType: string, eventData?: Record<string, unknown>) => void
}

const MARKDOWN_COMPONENTS = {
  h1: ({ children }: any) => <div className="smb-md-editor-md-title smb-md-editor-md-title-level-1">{children}</div>,
  h2: ({ children }: any) => <div className="smb-md-editor-md-title smb-md-editor-md-title-level-2">{children}</div>,
  h3: ({ children }: any) => <div className="smb-md-editor-md-title smb-md-editor-md-title-level-3">{children}</div>,
  h4: ({ children }: any) => <div className="smb-md-editor-md-title smb-md-editor-md-title-level-4">{children}</div>,
  h5: ({ children }: any) => <div className="smb-md-editor-md-title smb-md-editor-md-title-level-5">{children}</div>,
  h6: ({ children }: any) => <div className="smb-md-editor-md-title smb-md-editor-md-title-level-6">{children}</div>,
  p: ({ children }: any) => <div className="smb-md-editor-md-block">{children}</div>,
  ul: ({ children }: any) => <div className="smb-md-editor-md-list">{children}</div>,
  ol: ({ children }: any) => <div className="smb-md-editor-md-list">{children}</div>,
  li: ({ children }: any) => <div className="smb-md-editor-md-list-item">{children}</div>,
  blockquote: ({ children }: any) => <div className="smb-md-editor-md-quote">{children}</div>,
  pre: ({ children }: any) => <div className="smb-md-editor-md-pre">{children}</div>,
  code: ({ children }: any) => <span className="smb-md-editor-md-code">{children}</span>,
  a: ({ href, children }: any) => (
    <a className="smb-md-editor-md-link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  strong: ({ children }: any) => <span className="smb-md-editor-md-strong">{children}</span>,
  em: ({ children }: any) => <span className="smb-md-editor-md-em">{children}</span>,
}

const SmbMarkdownTextEditor = ({ data, config, onEvent }: SmbMarkdownTextEditorProps) => {
  const isReadOnly = config?.isReadOnly === true
  const isBusy = config?.isBusy === true
  const isMarkdown = config?.isMarkdown !== false
  const isPreviewVisible = isReadOnly || config?.isPreviewVisible === true
  const isSaveVisible = !isReadOnly && config?.isSaveVisible !== false
  const isCloseVisible = config?.isCloseVisible === true
  const isDismissVisible = config?.isDismissVisible !== false
  const messageState = data.messageState || { status: 'idle', messageText: '' }
  const messageDisplayText = messageState.messageText || config?.emptyMessageText || 'ready'
  const messageDisplayStatus = messageState.messageText ? messageState.status : 'empty'
  const heightStyle = typeof config?.height === 'number' ? `${config.height}px` : config?.height

  return (
    <div className="smb-md-editor-root" style={heightStyle ? { height: heightStyle } : undefined}>
      {(data.titleText || data.subtitleText || isMarkdown || isSaveVisible || isCloseVisible) ? (
        <div className="smb-md-editor-top-row">
          <div className="smb-md-editor-title-wrap">
            {data.titleText ? <div className="smb-md-editor-title">{data.titleText}</div> : null}
            {data.subtitleText ? <div className="smb-md-editor-subtitle">{data.subtitleText}</div> : null}
          </div>
          <div className="smb-md-editor-action-row">
            {isMarkdown && !isReadOnly ? (
              <button
                type="button"
                className="smb-md-editor-btn"
                disabled={isBusy}
                onClick={() => onEvent?.('previewToggleRequest')}
              >
                {isPreviewVisible ? 'hide preview' : 'show preview'}
              </button>
            ) : null}
            {isSaveVisible ? (
              <button
                type="button"
                className="smb-md-editor-btn"
                disabled={isBusy}
                onClick={() => onEvent?.('saveRequest')}
              >
                save
              </button>
            ) : null}
            {isCloseVisible ? (
              <button
                type="button"
                className="smb-md-editor-btn"
                disabled={isBusy}
                onClick={() => onEvent?.('closeRequest')}
              >
                close
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className={`smb-md-editor-message status-${messageDisplayStatus}`}>
        {isBusy ? <SpinningCircle width={12} height={12} /> : null}
        <span className="smb-md-editor-message-text">{messageDisplayText}</span>
        {isDismissVisible ? (
          <button
            type="button"
            className="smb-md-editor-message-dismiss"
            disabled={isBusy}
            onClick={() => onEvent?.('dismissMessageRequest')}
          >
            Dismiss
          </button>
        ) : null}
      </div>
      <div className={`smb-md-editor-body ${isPreviewVisible && !isReadOnly ? 'has-preview' : ''}`}>
        {!isReadOnly ? (
          <textarea
            className="smb-md-editor-input"
            value={data.contentText}
            spellCheck={false}
            disabled={isBusy}
            onChange={(event) => onEvent?.('contentChange', { contentText: event.target.value })}
          />
        ) : null}
        {isPreviewVisible ? (
          <div className="smb-md-editor-preview">
            {isMarkdown ? (
              <ReactMarkdown components={MARKDOWN_COMPONENTS}>
                {data.contentText}
              </ReactMarkdown>
            ) : (
              <pre className="smb-md-editor-plain-text">{data.contentText}</pre>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default SmbMarkdownTextEditor
