import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

/**
 * Shared markdown renderer used across all pages.
 *
 * Renders markdown content with styled headings, lists, links, code,
 * tables, and blockquotes — all themed to match the glass-panel design.
 */

interface MarkdownTextProps {
    children: string;
    /** Additional inline styles for the wrapper div */
    style?: React.CSSProperties;
    /** CSS class name for the wrapper div */
    className?: string;
}

const components: Components = {
    h1: ({ children }) => (
        <h1 style={{ color: 'var(--color-bright)', fontSize: '1.6rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.75rem' }}>{children}</h1>
    ),
    h2: ({ children }) => (
        <h2 style={{ color: 'var(--color-bright)', fontSize: '1.2rem', marginTop: '1.5rem', marginBottom: '0.75rem' }}>{children}</h2>
    ),
    h3: ({ children }) => (
        <h3 style={{ color: 'var(--primary)', fontSize: '1rem', marginTop: '1.25rem', marginBottom: '0.5rem' }}>{children}</h3>
    ),
    h4: ({ children }) => (
        <h4 style={{ color: 'var(--primary)', fontSize: '0.9rem', marginTop: '1rem', marginBottom: '0.4rem' }}>{children}</h4>
    ),
    p: ({ children }) => (
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '0.5rem' }}>{children}</p>
    ),
    ul: ({ children }) => (
        <ul style={{ listStyleType: 'disc', paddingLeft: '1.5rem', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>{children}</ul>
    ),
    ol: ({ children }) => (
        <ol style={{ listStyleType: 'decimal', paddingLeft: '1.5rem', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>{children}</ol>
    ),
    li: ({ children }) => (
        <li style={{ marginBottom: '0.3rem', lineHeight: 1.6 }}>{children}</li>
    ),
    a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>{children}</a>
    ),
    blockquote: ({ children }) => (
        <blockquote style={{ borderLeft: '3px solid var(--primary)', paddingLeft: '1rem', margin: '0.75rem 0', color: 'var(--text-dim)', fontStyle: 'italic' }}>{children}</blockquote>
    ),
    code: ({ children, className }) => {
        const isBlock = className?.startsWith('language-');
        if (isBlock) {
            return (
                <pre style={{ background: 'var(--panel-alpha-10)', padding: '1rem', borderRadius: '8px', overflow: 'auto', marginBottom: '0.75rem', border: '1px solid var(--glass-border)' }}>
                    <code style={{ fontSize: '0.85rem', fontFamily: "'Fira Code', 'Cascadia Code', monospace", color: 'var(--color-bright)' }}>{children}</code>
                </pre>
            );
        }
        return (
            <code style={{ background: 'var(--panel-alpha-10)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.85em', fontFamily: "'Fira Code', 'Cascadia Code', monospace", color: 'var(--primary)' }}>{children}</code>
        );
    },
    pre: ({ children }) => <>{children}</>,
    hr: () => (
        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '1.5rem 0' }} />
    ),
    table: ({ children }) => (
        <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>{children}</table>
        </div>
    ),
    thead: ({ children }) => (
        <thead style={{ borderBottom: '2px solid var(--glass-border)' }}>{children}</thead>
    ),
    th: ({ children }) => (
        <th style={{ padding: '0.5rem 0.75rem', color: 'var(--color-bright)', fontSize: '0.85rem' }}>{children}</th>
    ),
    td: ({ children }) => (
        <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--glass-border)' }}>{children}</td>
    ),
    strong: ({ children }) => (
        <strong style={{ color: 'var(--color-bright)', fontWeight: 600 }}>{children}</strong>
    ),
    em: ({ children }) => (
        <em>{children}</em>
    ),
};

const MarkdownText: React.FC<MarkdownTextProps> = ({ children, style, className }) => (
    <div className={className} style={{ lineHeight: 1.7, ...style }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {children}
        </ReactMarkdown>
    </div>
);

export default MarkdownText;
