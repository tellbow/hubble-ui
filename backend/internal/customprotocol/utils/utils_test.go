package utils

import "testing"

// Any client can post `{}` with content-type application/json; the router
// sets the channel id and response headers on what comes out.
func TestParseMessageFromJSONWithoutMeta(t *testing.T) {
	m, err := ParseMessageFromJSON([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	m.SetChannelId("c")
	m.ResponseHeaders.Set("x", "y")
}
