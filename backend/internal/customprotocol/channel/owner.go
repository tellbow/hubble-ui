package channel

import "context"

// Owner is who opened a channel: only they may poll it again. A nil Owner
// (no login configured) is anyone.
type Owner interface {
	OwnerKey() string
}

type ownerCtxKey struct{}

// WithOwner marks a request as coming from o.
func WithOwner(ctx context.Context, o Owner) context.Context {
	return context.WithValue(ctx, ownerCtxKey{}, o)
}

// OwnerFrom returns who sent the request, or nil.
func OwnerFrom(ctx context.Context) Owner {
	o, _ := ctx.Value(ownerCtxKey{}).(Owner)
	return o
}

func OwnerKey(o Owner) string {
	if o == nil {
		return ""
	}

	return o.OwnerKey()
}

// Owner is who opened the channel, or nil.
func (ch *Channel) Owner() Owner {
	return ch.owner
}

// CountOwnedUnsafe counts the channels opened by the owner with this key.
func (c *Channels) CountOwnedUnsafe(key string) int {
	n := 0
	for _, ch := range c.d {
		if OwnerKey(ch.owner) == key {
			n++
		}
	}

	return n
}
