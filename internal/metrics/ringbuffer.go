package metrics

import (
	"math"
	"sort"
	"sync"
)

const (
	// HighFreqCapacity stores 15 minutes at 1s resolution (900 points).
	HighFreqCapacity = 900
	// PreemptionCapacity stores the most recent 500 preemption events per node.
	PreemptionCapacity = 500
)

// rawTick stores a 1s computed MetricPoint alongside reset-safe per-tick deltas
// used by sliding-window calculations and 1-minute downsampling.
type rawTick struct {
	Point                   MetricPoint
	DurationSec             float64
	DeltaGenTokens          float64
	DeltaPromptTokens       float64
	DeltaPrefixHits         float64
	DeltaPrefixQueries      float64
	TtftDeltaBuckets        map[float64]float64
	ItlDeltaBuckets         map[float64]float64
	DeltaSpecDrafts         float64
	DeltaSpecDraftTokens    float64
	DeltaSpecAcceptedTokens float64
	DeltaSpecAcceptedPerPos map[int]float64
}

// tickRing is a fixed-capacity circular buffer of rawTick.
type tickRing struct {
	items []rawTick
	head  int
	count int
	cap   int
}

func newTickRing(capacity int) *tickRing {
	return &tickRing{
		items: make([]rawTick, capacity),
		cap:   capacity,
	}
}

func (r *tickRing) push(item rawTick) {
	if r.cap <= 0 {
		return
	}
	if r.count < r.cap {
		idx := (r.head + r.count) % r.cap
		r.items[idx] = item
		r.count++
		return
	}
	r.items[r.head] = item
	r.head = (r.head + 1) % r.cap
}

// forEachNewest iterates from newest to oldest until fn returns false.
func (r *tickRing) forEachNewest(fn func(rawTick) bool) {
	for i := r.count - 1; i >= 0; i-- {
		idx := (r.head + i) % r.cap
		if !fn(r.items[idx]) {
			return
		}
	}
}

// forEachOldest iterates from oldest to newest.
func (r *tickRing) forEachOldest(fn func(rawTick)) {
	for i := 0; i < r.count; i++ {
		idx := (r.head + i) % r.cap
		fn(r.items[idx])
	}
}

func (r *tickRing) latest() (rawTick, bool) {
	if r.count == 0 {
		return rawTick{}, false
	}
	idx := (r.head + r.count - 1) % r.cap
	return r.items[idx], true
}

// pointRing is a fixed-capacity circular buffer of downsampled MetricPoint.
type pointRing struct {
	items []MetricPoint
	head  int
	count int
	cap   int
}

func newPointRing(capacity int) *pointRing {
	return &pointRing{
		items: make([]MetricPoint, capacity),
		cap:   capacity,
	}
}

func (r *pointRing) push(item MetricPoint) {
	if r.cap <= 0 {
		return
	}
	if r.count < r.cap {
		idx := (r.head + r.count) % r.cap
		r.items[idx] = item
		r.count++
		return
	}
	r.items[r.head] = item
	r.head = (r.head + 1) % r.cap
}

func (r *pointRing) slice() []MetricPoint {
	out := make([]MetricPoint, 0, r.count)
	for i := 0; i < r.count; i++ {
		idx := (r.head + i) % r.cap
		out = append(out, r.items[idx])
	}
	return out
}

// preemptionRing is a fixed-capacity circular buffer of PreemptionEvent.
type preemptionRing struct {
	items []PreemptionEvent
	head  int
	count int
	cap   int
}

func newPreemptionRing(capacity int) *preemptionRing {
	return &preemptionRing{
		items: make([]PreemptionEvent, capacity),
		cap:   capacity,
	}
}

func (r *preemptionRing) push(item PreemptionEvent) {
	if r.cap <= 0 {
		return
	}
	if r.count < r.cap {
		idx := (r.head + r.count) % r.cap
		r.items[idx] = item
		r.count++
		return
	}
	r.items[r.head] = item
	r.head = (r.head + 1) % r.cap
}

func (r *preemptionRing) since(minTs int64) []PreemptionEvent {
	out := make([]PreemptionEvent, 0, r.count)
	for i := 0; i < r.count; i++ {
		idx := (r.head + i) % r.cap
		ev := r.items[idx]
		if ev.TimestampMs >= minTs {
			out = append(out, ev)
		}
	}
	return out
}

// DualRingBuffer manages the 1s high-frequency ring, 1m downsampled ring,
// and preemption event ring for a single node.
type DualRingBuffer struct {
	mu          sync.RWMutex
	high        *tickRing
	low         *pointRing
	preemptions *preemptionRing

	currentMinBucket int64
	pendingMinTicks  []rawTick
}

// NewDualRingBuffer creates a DualRingBuffer with 900 1s slots and retentionHours*60 1m slots.
func NewDualRingBuffer(retentionHours int) *DualRingBuffer {
	if retentionHours < 6 {
		retentionHours = 6
	} else if retentionHours > 24 {
		retentionHours = 24
	}
	return &DualRingBuffer{
		high:        newTickRing(HighFreqCapacity),
		low:         newPointRing(retentionHours * 60),
		preemptions: newPreemptionRing(PreemptionCapacity),
	}
}

// AppendTick pushes a 1s tick, rolls completed minute buckets into the 1m ring,
// and records any preemption event.
func (b *DualRingBuffer) AppendTick(t rawTick, ev *PreemptionEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.high.push(t)
	if ev != nil {
		b.preemptions.push(*ev)
	}

	minBucket := t.Point.TimestampMs / 60000
	if b.currentMinBucket == 0 {
		b.currentMinBucket = minBucket
	}
	if minBucket != b.currentMinBucket && len(b.pendingMinTicks) > 0 {
		agg := aggregateMinuteTicks(b.currentMinBucket*60000, b.pendingMinTicks)
		b.low.push(agg)
		b.pendingMinTicks = b.pendingMinTicks[:0]
		b.currentMinBucket = minBucket
	}
	b.pendingMinTicks = append(b.pendingMinTicks, t)
}

// HighFreqPoints returns all 1s points currently in the 15m ring.
func (b *DualRingBuffer) HighFreqPoints() []MetricPoint {
	b.mu.RLock()
	defer b.mu.RUnlock()

	out := make([]MetricPoint, 0, b.high.count)
	b.high.forEachOldest(func(t rawTick) {
		out = append(out, t.Point)
	})
	return out
}

// LowFreqPoints returns all 1m downsampled points plus the current in-progress minute bucket.
func (b *DualRingBuffer) LowFreqPoints() []MetricPoint {
	b.mu.RLock()
	defer b.mu.RUnlock()

	out := b.low.slice()
	if len(b.pendingMinTicks) > 0 {
		out = append(out, aggregateMinuteTicks(b.currentMinBucket*60000, b.pendingMinTicks))
	}
	return out
}

// PreemptionsSince returns preemption events on or after minTs (milliseconds).
func (b *DualRingBuffer) PreemptionsSince(minTs int64) []PreemptionEvent {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.preemptions.since(minTs)
}

// LatestTick returns the most recent rawTick if available.
func (b *DualRingBuffer) LatestTick() (rawTick, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.high.latest()
}

// WindowStats aggregates reset-safe deltas across ticks in [minTs, maxTs].
type WindowStats struct {
	GenTokens          float64
	PromptTokens       float64
	PrefixHits         float64
	PrefixQueries      float64
	TtftBuckets        map[float64]float64
	ItlBuckets         map[float64]float64
	SpecDrafts         float64
	SpecDraftTokens    float64
	SpecAcceptedTokens float64
	SpecAcceptedPerPos map[int]float64
	ElapsedSec         float64
	TickCount          int
}

// AggregateWindow collects reset-safe deltas over ticks with ts >= minTs.
// Caller must hold or manage concurrency appropriately if called externally;
// this method acquires RLock.
func (b *DualRingBuffer) AggregateWindow(minTs int64) WindowStats {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.aggregateWindowLocked(minTs)
}

func (b *DualRingBuffer) aggregateWindowLocked(minTs int64) WindowStats {
	stats := WindowStats{
		TtftBuckets:        make(map[float64]float64),
		ItlBuckets:         make(map[float64]float64),
		SpecAcceptedPerPos: make(map[int]float64),
	}

	var firstTs, lastTs int64
	var sumDuration float64

	b.high.forEachNewest(func(t rawTick) bool {
		if t.Point.TimestampMs < minTs {
			return false
		}
		if stats.TickCount == 0 {
			lastTs = t.Point.TimestampMs
		}
		firstTs = t.Point.TimestampMs
		stats.TickCount++
		sumDuration += t.DurationSec

		stats.GenTokens += t.DeltaGenTokens
		stats.PromptTokens += t.DeltaPromptTokens
		stats.PrefixHits += t.DeltaPrefixHits
		stats.PrefixQueries += t.DeltaPrefixQueries

		mergeBucketsInto(stats.TtftBuckets, t.TtftDeltaBuckets)
		mergeBucketsInto(stats.ItlBuckets, t.ItlDeltaBuckets)

		stats.SpecDrafts += t.DeltaSpecDrafts
		stats.SpecDraftTokens += t.DeltaSpecDraftTokens
		stats.SpecAcceptedTokens += t.DeltaSpecAcceptedTokens
		for pos, val := range t.DeltaSpecAcceptedPerPos {
			stats.SpecAcceptedPerPos[pos] += val
		}
		return true
	})

	if stats.TickCount > 1 && lastTs > firstTs {
		// Include one tick interval for the oldest tick in the window.
		stats.ElapsedSec = float64(lastTs-firstTs)/1000.0 + 1.0
	} else if sumDuration > 0 {
		stats.ElapsedSec = sumDuration
	} else if stats.TickCount > 0 {
		stats.ElapsedSec = 1.0
	}
	return stats
}

func mergeBucketsInto(dst, src map[float64]float64) {
	for le, v := range src {
		if v > 0 {
			dst[le] += v
		}
	}
}

func aggregateMinuteTicks(bucketTs int64, ticks []rawTick) MetricPoint {
	n := float64(len(ticks))
	var (
		sumGen, sumPrompt              float64
		sumRun, sumWait, sumCap, sumDf float64
		sumKV, maxKV                   float64
		sumDeltaPreempt                float64
		sumPrefixHits, sumPrefixQ      float64
		hasWaitingByReason             bool
	)
	ttftBuckets := make(map[float64]float64)
	itlBuckets := make(map[float64]float64)

	for _, t := range ticks {
		p := t.Point
		sumGen += p.GenTokPerSec
		sumPrompt += p.PromptTokPerSec
		sumRun += p.Running
		sumWait += p.Waiting
		sumCap += p.WaitingCapacity
		sumDf += p.WaitingDeferred
		if p.HasWaitingByReason {
			hasWaitingByReason = true
		}
		sumKV += p.KvCachePct
		if p.MaxKvCachePct > maxKV {
			maxKV = p.MaxKvCachePct
		} else if p.KvCachePct > maxKV {
			maxKV = p.KvCachePct
		}
		sumDeltaPreempt += p.DeltaPreemptions
		sumPrefixHits += t.DeltaPrefixHits
		sumPrefixQ += t.DeltaPrefixQueries
		mergeBucketsInto(ttftBuckets, t.TtftDeltaBuckets)
		mergeBucketsInto(itlBuckets, t.ItlDeltaBuckets)
	}

	last := ticks[len(ticks)-1].Point
	var prefixPtr *float64
	prefixIdle := false
	if sumPrefixQ <= 0 {
		prefixIdle = true
	} else {
		rate := clampPct(sumPrefixHits / sumPrefixQ * 100.0)
		prefixPtr = &rate
	}

	return MetricPoint{
		TimestampMs:        bucketTs,
		GenTokPerSec:       round2(sumGen / n),
		PromptTokPerSec:    round2(sumPrompt / n),
		Running:            round2(sumRun / n),
		Waiting:            round2(sumWait / n),
		WaitingCapacity:    round2(sumCap / n),
		WaitingDeferred:    round2(sumDf / n),
		HasWaitingByReason: hasWaitingByReason,
		KvCachePct:         round2(sumKV / n),
		MaxKvCachePct:      round2(maxKV),
		DeltaPreemptions:   sumDeltaPreempt,
		TotalPreemptions:   last.TotalPreemptions,
		PrefixCacheHitRate: prefixPtr,
		PrefixCacheIdle:    prefixIdle,
		TtftP50Ms:          HistogramQuantileMs(0.50, ttftBuckets),
		TtftP95Ms:          HistogramQuantileMs(0.95, ttftBuckets),
		ItlP50Ms:           HistogramQuantileMs(0.50, itlBuckets),
		ItlP95Ms:           HistogramQuantileMs(0.95, itlBuckets),
	}
}

// HistogramQuantileMs computes the Prometheus histogram_quantile(q, sum(buckets))
// using linear interpolation and returns the result in milliseconds.
// Expects cumulative bucket counts keyed by upper bound `le` in seconds (including +Inf).
// Returns nil when total count <= 0 or no finite buckets exist.
func HistogramQuantileMs(q float64, buckets map[float64]float64) *float64 {
	if len(buckets) == 0 || q < 0 || q > 1 {
		return nil
	}

	finiteBounds := make([]float64, 0, len(buckets))
	hasInf := false
	infCount := 0.0

	for le, count := range buckets {
		if math.IsNaN(count) || count < 0 {
			continue
		}
		if math.IsInf(le, 1) {
			hasInf = true
			infCount = count
			continue
		}
		finiteBounds = append(finiteBounds, le)
	}
	if len(finiteBounds) == 0 {
		return nil
	}
	sort.Float64s(finiteBounds)

	counts := make([]float64, len(finiteBounds))
	prev := 0.0
	for i, le := range finiteBounds {
		v := buckets[le]
		if v < prev {
			v = prev
		}
		counts[i] = v
		prev = v
	}

	total := prev
	if hasInf && infCount > total {
		total = infCount
	}
	if total <= 0 {
		return nil
	}

	rank := q * total
	if rank <= 0 {
		zero := 0.0
		return &zero
	}

	idx := -1
	for i, c := range counts {
		if c >= rank {
			idx = i
			break
		}
	}

	var secVal float64
	if idx == -1 {
		// Falls into +Inf bucket: Prometheus returns the highest finite bucket bound.
		secVal = finiteBounds[len(finiteBounds)-1]
	} else {
		bucketStart := 0.0
		countStart := 0.0
		if idx > 0 {
			bucketStart = finiteBounds[idx-1]
			countStart = counts[idx-1]
		}
		bucketEnd := finiteBounds[idx]
		countEnd := counts[idx]
		bucketCount := countEnd - countStart
		if bucketCount <= 0 {
			secVal = bucketEnd
		} else {
			secVal = bucketStart + (bucketEnd-bucketStart)*((rank-countStart)/bucketCount)
		}
	}

	ms := round2(secVal * 1000.0)
	return &ms
}

func clampPct(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return round2(v)
}

func round2(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Round(v*100) / 100
}
