# Test image fixtures

The end-to-end test (`tests/e2e/run-e2e.sh`) needs a parking image to submit
to the live Gemini API.

## Quickest option

Drop a JPEG/PNG/WebP image of any car parked on a street here, named
`sample.jpg`. The script defaults to `tests/e2e/fixtures/sample.jpg`.

## Recommended images for dissertation evidence

For the dissertation evaluation chapter you want **three** images that exercise
different paths:

| File suggestion        | Scenario                              | Expected verdict                     |
| ---------------------- | ------------------------------------- | ------------------------------------ |
| `violation-clear.jpg`  | Car on a pedestrian crossing or pavement | `violationConfirmed: true`, conf ≥ 0.8 |
| `legal-parking.jpg`    | Car legally parked in a marked bay    | `violationConfirmed: false`          |
| `non-parking-scene.jpg`| A photo with no car at all (e.g. a tree) | `violationConfirmed: false` with explanation |

Run the script three times, once per image, with `--image`:

```bash
./tests/e2e/run-e2e.sh --image tests/e2e/fixtures/violation-clear.jpg
./tests/e2e/run-e2e.sh --image tests/e2e/fixtures/legal-parking.jpg
./tests/e2e/run-e2e.sh --image tests/e2e/fixtures/non-parking-scene.jpg
```

## Privacy

Avoid images that contain:
- visible people's faces
- legible number plates of real vehicles you don't own

If your test images contain these, blur them in your screenshots before
including them in the dissertation.

## Where to source CC0 images

- https://www.pexels.com/search/parking%20violation/
- https://unsplash.com/s/photos/parked-car
- Photos you take yourself

These fixtures are **gitignored** by the parent `.gitignore` to keep image
data out of git history. The script copies the image you submit into the
artefact folder, so the evidence stays with the run.
