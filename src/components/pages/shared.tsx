import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { WishRow } from "@/components/wishlist";
import { xapi, type WishStatus } from "@/lib/gifts/api-extra";

export function SharedPage() {
  const queryClient = useQueryClient();
  const lists = useQuery({ queryKey: ["shared"], queryFn: xapi.sharedLists });
  const claim = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WishStatus }) => xapi.claimShared(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["shared"] }),
  });
  const data = lists.data?.lists ?? [];
  const households = [...new Set(data.map((l) => l.household.name))];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Shared wishlists</h1>
          <p className="mt-1 text-sm text-muted">Wishlists from linked households. Reserve something so no one doubles up. They’ll never see who.</p>
        </div>
      </div>
      {lists.isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
      {!lists.isLoading && data.length === 0 ? (
        <section className="card empty" style={{ maxWidth: 560 }}>
          <h2 className="card-title" style={{ fontSize: "1.25rem" }}>
            Nothing shared with you yet
          </h2>
          <p className="text-muted">Link another household and choose who to share, then their wishlists show up here.</p>
          <div>
            <Link to="/settings" search={{ tab: "sharing" }} className="btn btn-primary press">
              Set up sharing
            </Link>
          </div>
        </section>
      ) : null}
      {households.map((household) => (
        <section key={household} className="mb-6">
          <h2 className="section-title" style={{ marginTop: 0 }}>
            {household}
          </h2>
          <div className="card-grid">
            {data
              .filter((l) => l.household.name === household)
              .map((list) => (
                <article key={list.person.id} className="card" aria-label={`${list.person.name}’s wishlist`}>
                  <h3 className="card-title">{list.person.name}</h3>
                  {list.person.role ? <p className="card-sub">{list.person.role}</p> : null}
                  {list.items.length === 0 ? (
                    <p className="mt-3 text-sm text-muted">Nothing on this list yet.</p>
                  ) : (
                    <ul className="wish-list">
                      {list.items.map((item) => (
                        <WishRow key={item.id} item={item} isSelf={false} onClaim={(status) => claim.mutate({ id: item.id, status })} />
                      ))}
                    </ul>
                  )}
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
