import { Link } from 'react-aria-components';
import { renderSafeMarkdown, type SafeNode } from '#/entities/assistant';
import styles from '#/widgets/assistant-panel/ui/MessageText/MessageText.module.css';

// Each node kind the safe parser can make is one element here, and nothing
// else is drawn: there is no way for model text to become an image, a script
// or a link that leaves the console.
function Nodes({ nodes, tableLabel }: { nodes: readonly SafeNode[]; tableLabel: string }) {
  return nodes.map((node, index) => (
    <Node key={`${String(index)}:${node.kind}`} node={node} tableLabel={tableLabel} />
  ));
}

function Node({ node, tableLabel }: { node: SafeNode; tableLabel: string }) {
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
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </strong>
      );
    case 'em':
      return (
        <em>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </em>
      );
    case 'p':
      return (
        <p className={styles.paragraph}>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </p>
      );
    case 'ul':
      return (
        <ul className={styles.list}>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </ul>
      );
    case 'ol':
      return (
        <ol className={styles.list}>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </ol>
      );
    case 'li':
      return (
        <li>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </li>
      );
    case 'table':
      // The region is what a keyboard reaches to scroll a table wider than the
      // message, so it is named, and the table inside it needs no caption.
      return (
        <div className={styles.tableScroll} role="region" aria-label={tableLabel} tabIndex={0}>
          <table className={styles.table}>
            <Nodes nodes={node.children} tableLabel={tableLabel} />
          </table>
        </div>
      );
    case 'thead':
      return (
        <thead>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </thead>
      );
    case 'tbody':
      return (
        <tbody>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </tbody>
      );
    case 'tr':
      return (
        <tr>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </tr>
      );
    case 'th':
      return (
        <th scope="col" className={styles.cell}>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </th>
      );
    case 'td':
      return (
        <td className={styles.cell}>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </td>
      );
    case 'link':
      return (
        <Link href={node.href} className={styles.link ?? ''}>
          <Nodes nodes={node.children} tableLabel={tableLabel} />
        </Link>
      );
  }
}

// One block of the answer, parsed once: the compiler keeps what a block made
// until its text changes, so a block that has settled costs nothing as the
// answer grows.
function Block({ text, tableLabel }: { text: string; tableLabel: string }) {
  return <Nodes nodes={renderSafeMarkdown(text)} tableLabel={tableLabel} />;
}

// An answer as it is written. Blocks closed by a blank line are settled and
// parsed once; only the block still being written is parsed again per update.
export function MessageText({
  settled,
  open,
  tableLabel,
}: {
  settled: readonly string[];
  open: string;
  tableLabel: string;
}) {
  return (
    <div className={styles.text}>
      {settled.map((block, index) => (
        <Block key={String(index)} text={block} tableLabel={tableLabel} />
      ))}
      {open === '' ? null : <Block key="open" text={open} tableLabel={tableLabel} />}
    </div>
  );
}
