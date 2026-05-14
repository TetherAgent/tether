import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

type DiscussionChoice = {
  key: string;
  title: string;
  body: string;
};

type DiscussionSection = {
  key: string;
  title: string;
  description: string;
  body: string;
  choices: DiscussionChoice[];
};

export type DiscussionCards = {
  intro: string;
  sections: DiscussionSection[];
  variant: 'questions' | 'choices';
};

const NUMBERED_SECTION_RE = /^\*\*\[(\d+)\]\s+(.+?)\*\*\s*(?:[—-]\s*(.*))?$/;
const NUMBERED_CHOICE_RE = /^([A-Z])\.\s+\*\*(.+?)\*\*\s*(.*)$/;
const LETTER_SECTION_RE = /^\*\*([A-Z])\s*[—-]\s*(.+?)\*\*\s*(.*)$/;

function appendLine(current: string, line: string): string {
  return `${current}${current && line.trim() ? '\n' : ''}${line}`.trim();
}

function parseNumberedQuestions(lines: string[]): DiscussionCards | null {
  const firstSectionIndex = lines.findIndex((line) => NUMBERED_SECTION_RE.test(line.trim()));
  if (firstSectionIndex < 0) {
    return null;
  }

  const sections: DiscussionSection[] = [];
  let index = firstSectionIndex;

  while (index < lines.length) {
    const header = lines[index].trim();
    const match = NUMBERED_SECTION_RE.exec(header);
    if (!match) {
      index += 1;
      continue;
    }

    const [, key, title, description = ''] = match;
    index += 1;
    const block: string[] = [];
    while (index < lines.length && !NUMBERED_SECTION_RE.test(lines[index].trim())) {
      if (lines[index].trim() !== '---') {
        block.push(lines[index]);
      }
      index += 1;
    }

    const bodyLines: string[] = [];
    const choices: DiscussionChoice[] = [];
    let activeChoice: DiscussionChoice | null = null;

    for (const line of block) {
      const choiceMatch = NUMBERED_CHOICE_RE.exec(line.trim());
      if (choiceMatch) {
        const [, choiceKey, choiceTitle, rest = ''] = choiceMatch;
        activeChoice = { key: choiceKey, title: choiceTitle, body: rest.trim() };
        choices.push(activeChoice);
        continue;
      }
      if (activeChoice) {
        activeChoice.body = appendLine(activeChoice.body, line);
      } else {
        bodyLines.push(line);
      }
    }

    sections.push({
      key,
      title: title.trim(),
      description: description.trim(),
      body: bodyLines.join('\n').trim(),
      choices
    });
  }

  return sections.length > 0
    ? { intro: lines.slice(0, firstSectionIndex).join('\n').trim(), sections, variant: 'questions' }
    : null;
}

function parseLetterChoices(lines: string[]): DiscussionCards | null {
  const firstSectionIndex = lines.findIndex((line) => LETTER_SECTION_RE.test(line.trim()));
  if (firstSectionIndex < 0) {
    return null;
  }

  const sections: DiscussionSection[] = [];
  let index = firstSectionIndex;

  while (index < lines.length) {
    const header = lines[index].trim();
    const match = LETTER_SECTION_RE.exec(header);
    if (!match) {
      index += 1;
      continue;
    }

    const [, key, title, description = ''] = match;
    index += 1;
    const body: string[] = [];
    while (index < lines.length && !LETTER_SECTION_RE.test(lines[index].trim())) {
      if (lines[index].trim() !== '---') {
        body.push(lines[index]);
      }
      index += 1;
    }

    sections.push({
      key,
      title: title.trim(),
      description: description.trim(),
      body: body.join('\n').trim(),
      choices: []
    });
  }

  return sections.length > 0
    ? { intro: lines.slice(0, firstSectionIndex).join('\n').trim(), sections, variant: 'choices' }
    : null;
}

export function parseDiscussionCards(text: string): DiscussionCards | null {
  if (!text.includes('/gsd-') && !text.includes('Phase') && !text.includes('灰色地带') && !text.includes('需要讨论')) {
    return null;
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return parseNumberedQuestions(lines) ?? parseLetterChoices(lines);
}

function MarkdownFragment({ children, components }: { children: string; components: Components }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}

function choiceInputText(section: DiscussionSection, choice?: DiscussionChoice): string {
  if (choice) {
    const body = choice.body.trim();
    return `${section.key}:${choice.key}${choice.title}${body ? `\n${body}` : ''}`;
  }
  const body = section.body.trim();
  return `${section.key}:${section.title}${body ? `\n${body}` : ''}`;
}

export function DiscussionChoiceCards({
  cards,
  components,
  onChoiceClick
}: {
  cards: DiscussionCards;
  components: Components;
  onChoiceClick?: (text: string) => void;
}) {
  return (
    <div className="gsd-discussion">
      {cards.intro ? (
        <div className="gsd-discussion-intro">
          <MarkdownFragment components={components}>{cards.intro}</MarkdownFragment>
        </div>
      ) : null}
      <div className="gsd-question-list">
        {cards.sections.map((section) => (
          <section className="gsd-question-card" key={section.key}>
            <div className="gsd-question-head">
              <span className="gsd-question-index">
                {cards.variant === 'questions' ? `[${section.key}]` : section.key}
              </span>
              <div className="gsd-question-title">
                <h3>{section.title}</h3>
                {section.description ? <p>{section.description}</p> : null}
              </div>
            </div>
            {section.body && cards.variant === 'questions' ? (
              <div className="gsd-question-body">
                <MarkdownFragment components={components}>{section.body}</MarkdownFragment>
              </div>
            ) : null}
            {cards.variant === 'choices' ? (
              <div className="gsd-choice-full">
                <button
                  className="gsd-choice-card gsd-choice-card-large"
                  type="button"
                  title="点击追加到输入框"
                  onClick={() => onChoiceClick?.(choiceInputText(section))}
                >
                  <div className="gsd-choice-content">
                    {section.body ? <MarkdownFragment components={components}>{section.body}</MarkdownFragment> : null}
                  </div>
                </button>
              </div>
            ) : null}
            {section.choices.length > 0 ? (
              <div className="gsd-choice-grid">
                {section.choices.map((choice) => (
                  <button
                    className="gsd-choice-card"
                    key={choice.key}
                    type="button"
                    title="点击追加到输入框"
                    onClick={() => onChoiceClick?.(choiceInputText(section, choice))}
                  >
                    <div className="gsd-choice-label">{choice.key}</div>
                    <div className="gsd-choice-content">
                      <strong>{choice.title}</strong>
                      {choice.body ? <MarkdownFragment components={components}>{choice.body}</MarkdownFragment> : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
