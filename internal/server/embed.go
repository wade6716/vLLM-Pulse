package server

import "embed"

// DistFS embeds the built frontend static assets from internal/server/dist.
//
//go:embed all:dist
var DistFS embed.FS
