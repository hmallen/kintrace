import type { GedcomReviewGroup, GedcomReviewItem } from '@shared/api.js';
import {
  useGedcomReviewQueue,
  useReviewGedcomGroup,
  useReviewGedcomItem,
} from '../api/hooks';

const GROUP_TITLES: Record<GedcomReviewGroup, string> = {
  people: 'People',
  relationships: 'Relationships',
  events: 'Events',
};

function ReviewItem({ item }: { item: GedcomReviewItem }) {
  const review = useReviewGedcomItem();
  const details = Object.entries(item.payload).filter(([, value]) => value !== null && value !== 'unknown');
  return (
    <li>
      <details>
        <summary>{item.label}</summary>
        <dl>
          {details.map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
      {item.status === 'pending' ? (
        <span>
          <button
            type="button"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: item.id, action: 'accept' })}
          >
            Accept
          </button>{' '}
          <button
            type="button"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: item.id, action: 'reject' })}
          >
            Reject
          </button>
          {review.error && <span role="alert"> {review.error.message}</span>}
        </span>
      ) : (
        <span>— {item.status}</span>
      )}
    </li>
  );
}

export function GedcomReview() {
  const queue = useGedcomReviewQueue();
  const reviewGroup = useReviewGedcomGroup();

  if (queue.isPending) return <p>Loading GEDCOM review queue…</p>;
  if (queue.error) throw queue.error;

  const itemCount = queue.data.groups.reduce((total, group) => total + group.items.length, 0);
  return (
    <section>
      <h2>GEDCOM review queue</h2>
      <p>
        Review proposed records before adding them to KinTrace. Accept people before relationships
        and events so references can be linked.
      </p>
      {itemCount === 0 && <p>No GEDCOM records are waiting for review.</p>}
      {queue.data.groups.map(({ group, items }) => {
        const pending = items.filter((item) => item.status === 'pending').length;
        return (
          <section key={group} aria-labelledby={`gedcom-review-${group}`}>
            <h3 id={`gedcom-review-${group}`}>{GROUP_TITLES[group]} ({pending} pending)</h3>
            {pending > 0 && (
              <p>
                <button
                  type="button"
                  disabled={reviewGroup.isPending}
                  onClick={() => reviewGroup.mutate({ group, action: 'accept' })}
                >
                  Accept all {GROUP_TITLES[group].toLowerCase()}
                </button>{' '}
                <button
                  type="button"
                  disabled={reviewGroup.isPending}
                  onClick={() => reviewGroup.mutate({ group, action: 'reject' })}
                >
                  Reject all
                </button>
              </p>
            )}
            {items.length > 0 ? (
              <ul>{items.map((item) => <ReviewItem key={item.id} item={item} />)}</ul>
            ) : (
              <p>No {GROUP_TITLES[group].toLowerCase()} in the queue.</p>
            )}
          </section>
        );
      })}
      {reviewGroup.error && <p role="alert">{reviewGroup.error.message}</p>}
    </section>
  );
}
