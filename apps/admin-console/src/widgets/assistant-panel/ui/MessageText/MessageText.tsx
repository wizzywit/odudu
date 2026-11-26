import { Link } from 'react-aria-components';
import { renderSafeMarkdown, type SafeNode } from '#/entities/assistant';
import styles from '#/widgets/assistant-panel/ui/MessageText/MessageText.module.css';

// Each node kind the safe parser can make is one element here, and nothing
// else is drawn: there is no way for model text to become an image, a script
// or a link that leaves the console.
function Nodes({ nodes }: { nodes: readonly SafeNode[] }) {
  return nodes.map((node, index) => <Node key={`${String(index)}:${node.kind}`} node={node} />);
}

function Node({ node }: { node: SafeNode }) {
  switch (node.kind) {
    case 'text':
      return node.text;
    case 'code':
      return <code className={styles.code}>{node.text}</code>;
    case 'pre':
      return (
        <pre className={styles.pre} tabIndex={0}>
          <code>{node.text}</code>
        </pre>
      );
    case 'br':
      return <br />;
    case 'strong':
      return (
        <strong>
          <Nodes nodes={node.children} />
        </strong>
      );
    case 'em':
      return (
        <em>
          <Nodes nodes={node.children} />
        </em>
      );
    case 'p':
      return (
        <p className={styles.paragraph}>
          <Nodes nodes={node.children} />
        </p>
      );
    case 'ul':
      return (
        <ul className={styles.list}>
          <Nodes nodes={node.children} />
        </ul>
      );
    case 'ol':
      return (
        <ol className={styles.list}>
          <Nodes nodes={node.children} />
        </ol>
      );
    case 'li':
      return (
        <li>
          <Nodes nodes={node.children} />
        </li>
      );
    case 'link':
      return (
        <Link href={node.href} className={styles.link ?? ''}>
          <Nodes nodes={node.children} />
        </Link>
      );
  }
}

// One block of the answer, parsed once: the compiler keeps what a block made
// until its text changes, so a block that has settled costs nothing as the
// answer grows.
function Block({ text }: { text: string }) {
  return <Nodes nodes={renderSafeMarkdown(text)} />;
}

// An answer as it is written. Blocks closed by a blank line are settled and
// parsed once; only the block still being written is parsed again per update.
export function MessageText({ settled, open }: { settled: readonly string[]; open: string }) {
  return (
    <div className={styles.text}>
      {settled.map((block, index) => (
        <Block key={String(index)} text={block} />
      ))}
      {open === '' ? null : <Block key="open" text={open} />}
    </div>
  );
}
