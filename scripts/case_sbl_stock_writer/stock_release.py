"""Exact official stock image identities accepted by the wired writer."""

STOCK_IMAGE_VERSIONS = {
    "36c5b0e499a68ac2493a497bdab9740fd3e7027730c26a9094eca47268a27863": "2.2.6.10",
    "d6d29ec6a6d7d3f7e0abb260c54493e2e5dd0ed978346dc41061ee6522d40fc6": "2.3.2.14",
    "33f9eb7a47f996b8bcf34ac9df8bc2f7b698a6512cbf370d25b3215ad0dde298": "2.4.0.24",
}


def expected_stock_version(image_sha256: str) -> str:
    try:
        return STOCK_IMAGE_VERSIONS[image_sha256.lower()]
    except KeyError as error:
        raise ValueError("stock image SHA-256 has no pinned postflight version") from error
