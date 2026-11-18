import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, ChevronDown, Search, X } from 'lucide-react';
import { guideSections, matchesGuideTopic } from '../content/user-guide';
import '../user-guide.css';

export function UserGuidePage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const searching = Boolean(query.trim());
  const sections = guideSections.filter(section => category === 'all' || category === section.id)
    .map(section => ({ ...section, topics: section.topics.filter(topic => matchesGuideTopic(topic, section.title, query)) }))
    .filter(section => section.topics.length > 0);
  const count = sections.reduce((total, section) => total + section.topics.length, 0);
  function reset() { setQuery(''); setCategory('all'); }

  return <main className="page user-guide">
    <header className="guide-hero">
      <span className="guide-mark"><BookOpen aria-hidden="true" /></span>
      <div><p className="guide-eyebrow">FUELNERVE USER GUIDE</p><h1>How to use FuelNerve</h1><p>Find the right screen, follow the steps and keep your fuel station moving.</p></div>
    </header>
    <section className="guide-search-panel" aria-label="Find help">
      <label htmlFor="guide-search">What would you like to do?</label>
      <div className="guide-search"><Search aria-hidden="true" /><input id="guide-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search shifts, DSR, RSP, customer payments…" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X /></button>}</div>
      <div className="guide-shortcuts"><span>Popular searches</span>{['Close a shift', 'DSR', 'RSP', 'WhatsApp'].map(term => <button type="button" key={term} onClick={() => { setCategory('all'); setQuery(term); }}>{term}</button>)}</div>
    </section>
    <div className="guide-layout">
      <nav className="guide-categories" aria-label="Guide sections"><h2>Explore the guide</h2><button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All topics</button>{guideSections.map(section => <button type="button" key={section.id} aria-pressed={category === section.id} onClick={() => setCategory(section.id)}>{section.title}</button>)}<Link to="/help">Contact support <ArrowRight aria-hidden="true" /></Link></nav>
      <div className="guide-results">
        <p className="guide-result-count" role="status">{count} {count === 1 ? 'topic' : 'topics'}{searching ? ` matching “${query.trim()}”` : category === 'all' ? ' to help you find your way' : ''}</p>
        {count === 0 && <section className="guide-empty"><Search aria-hidden="true" /><h2>No matching topics</h2><p>Try a shorter search, such as “invoice”, “dip” or “password”, or explore all topics.</p><button type="button" className="primary" onClick={reset}>Show all topics</button><Link to="/help">Get help from support <ArrowRight aria-hidden="true" /></Link></section>}
        {sections.map(section => <section className="guide-section" key={section.id} aria-labelledby={`guide-${section.id}`}><header><h2 id={`guide-${section.id}`}>{section.title}</h2><p>{section.description}</p></header>{section.topics.map(topic => <details className="guide-topic" key={`${topic.route}-${topic.title}`} open={searching || undefined}><summary>{topic.title}<ChevronDown aria-hidden="true" /></summary><div className="guide-topic-body"><p className="guide-location">{topic.destination}</p><ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol><Link to={topic.route}>Open {topic.destination.split(' → ').at(-1)} <ArrowRight aria-hidden="true" /></Link></div></details>)}</section>)}
        <footer className="guide-footer"><BookOpen aria-hidden="true" /><div><h2>Need a hand with a specific record?</h2><p>Send the details and a screenshot to our support team.</p></div><Link to="/help">Help & support <ArrowRight aria-hidden="true" /></Link></footer>
      </div>
    </div>
  </main>;
}
