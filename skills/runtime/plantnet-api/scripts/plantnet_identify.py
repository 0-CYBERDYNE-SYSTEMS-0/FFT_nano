#!/usr/bin/env python3
"""
PlantNet API Plant Identification Tool
Identify plants using the PlantNet API (https://plantnet.org)
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
import urllib.request
import urllib.error
from urllib.parse import urlencode
import subprocess

# Configuration — set PLANTNET_API_KEY in your environment or .env
API_KEY = os.environ.get("PLANTNET_API_KEY", "")
if not API_KEY:
    print("Error: PLANTNET_API_KEY environment variable is not set.")
    print("Get a free key at https://my.plantnet.org — set it in your .env: PLANTNET_API_KEY=your_key_here")
    sys.exit(1)
BASE_URL = "https://my-api.plantnet.org/v2/identify"
ORGANS = ["leaf", "flower", "fruit", "bark", "auto"]
# Note: Valid projects are region/flora databases from PlantNet
# Common projects include: k-world-flora, useful, weeds, plus regional projects like:
# k-western-europe, k-western-canada, k-brazil, etc.
# See https://my-api.plantnet.org/v2/projects for full list
# Use 'all' for best results
PROJECTS = ["all"]


def log_identification(prompt: str, image_files: list, results: dict, status: str):
    """Log identification details to log file"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    images_str = ", ".join([Path(f).name for f in image_files])
    log_entry = f"\n## {timestamp}\n- **Images**: {images_str}\n- **Status**: {status}\n"

    if status == "Success" and results:
        best_match = results.get("bestMatch", "N/A")
        if "results" in results and results["results"]:
            top_result = results["results"][0]
            score = top_result.get("score", 0) * 100
            species = top_result.get("species", {})
            scientific = species.get("scientificNameWithoutAuthor", "N/A")
            common = ", ".join(species.get("commonNames", [])[:3])
            log_entry += f"- **Best Match**: {best_match}\n- **Top Confidence**: {score:.1f}%\n- **Scientific**: {scientific}\n- **Common Names**: {common}\n"

        quota = results.get("remainingIdentificationRequests", "N/A")
        log_entry += f"- **Remaining Requests**: {quota}\n"

    log_file = Path(__file__).parent / "identification_log.md"
    with open(log_file, "a") as f:
        f.write(log_entry)


def identify_plant(image_files: list, organs: list = None, project: str = "all",
                include_related: bool = False, no_reject: bool = False,
                nb_results: int = None, detailed: bool = False,
                lang: str = "en") -> dict:
    """
    Identify plant(s) from image files using PlantNet API

    Args:
        image_files: List of image file paths (1-5 images, same plant)
        organs: List of plant organs (one per image) or None for auto
        project: Project/flora database (default: "all")
        include_related: Include reference images in response
        no_reject: Don't reject if top result isn't a plant
        nb_results: Limit number of results
        detailed: Include family/genus results (slower)
        lang: Language code for common names

    Returns:
        Dictionary with API response or error info
    """
    # Build query parameters (project goes in URL path, not query params)
    params = {
        "api-key": API_KEY,
    }

    if include_related:
        params["include-related-images"] = "true"
    if no_reject:
        params["no-reject"] = "true"
    if nb_results:
        params["nb-results"] = str(nb_results)
    if detailed:
        params["detailed"] = "true"
    if lang:
        params["lang"] = lang

    # Build URL with query parameters
    query_string = urlencode(params)
    url = f"{BASE_URL}/{project}?{query_string}"

    # Build curl command (more reliable for multipart/form-data)
    curl_cmd = ["curl", "-X", "POST", url]

    # Add image files
    for i, image_file in enumerate(image_files):
        if not os.path.exists(image_file):
            return {"error": f"Image file not found: {image_file}", "status": "error"}

        curl_cmd.extend(["-F", f"images=@{image_file}"])

        # Add organ for this image
        if organs:
            if i < len(organs):
                curl_cmd.extend(["-F", f"organs={organs[i]}"])
            else:
                curl_cmd.extend(["-F", "organs=auto"])
        else:
            curl_cmd.extend(["-F", "organs=auto"])

    try:
        result = subprocess.run(curl_cmd, capture_output=True, text=True, timeout=60)
        response_text = result.stdout

        if result.returncode != 0:
            error_text = result.stderr
            return {"error": f"Curl failed: {error_text}", "status": "error", "code": result.returncode}

        result_data = json.loads(response_text)

        # Check for API errors (only present on errors)
        if "statusCode" in result_data and result_data["statusCode"] != 200:
            error_msg = result_data.get("error", "Unknown error")
            return {"error": error_msg, "status": "error", "details": result_data}

        # Check for valid results (success doesn't have statusCode field)
        if "results" in result_data:
            return {"status": "success", "data": result_data}
        else:
            return {"error": "Unexpected response format", "status": "error", "details": result_data}

    except subprocess.TimeoutExpired:
        return {"error": "Request timeout after 60 seconds", "status": "error"}

    except json.JSONDecodeError as e:
        return {"error": f"Failed to parse JSON response: {e}", "status": "error"}

    except Exception as e:
        return {"error": str(e), "status": "error"}


def format_results(results: dict, verbose: bool = True):
    """Format API results for display"""
    if "data" not in results:
        print(f"Error: {results.get('error', 'Unknown error')}")
        return

    data = results["data"]

    print(f"\n{'='*60}")
    print(f"PlantNet Identification Results")
    print(f"{'='*60}\n")

    # Display best match
    best_match = data.get("bestMatch", "N/A")
    print(f"🎯 Best Match: {best_match}")

    # Display remaining quota
    quota = data.get("remainingIdentificationRequests", "N/A")
    print(f"📊 Remaining Requests: {quota}\n")

    # Display results
    if "results" in data and data["results"]:
        for i, result in enumerate(data["results"][:10], 1):  # Show top 10 max
            score = result.get("score", 0) * 100
            species = result.get("species", {})
            scientific = species.get("scientificNameWithoutAuthor", "N/A")
            author = species.get("scientificNameAuthorship", "")
            genus = species.get("genus", {}).get("scientificNameWithoutAuthor", "")
            family = species.get("family", {}).get("scientificNameWithoutAuthor", "")
            common_names = species.get("commonNames", [])

            print(f"\n{i}. {scientific} {author}")
            print(f"   Confidence: {score:.1f}%")
            if common_names:
                print(f"   Common names: {', '.join(common_names[:5])}")
            if genus:
                print(f"   Genus: {genus}")
            if family:
                print(f"   Family: {family}")

            # Show GBIF/PowO IDs if available
            if verbose:
                if "gbif" in result:
                    print(f"   GBIF ID: {result['gbif'].get('id', 'N/A')}")
                if "powo" in result:
                    print(f"   PowO ID: {result['powo'].get('id', 'N/A')}")

    # Display other results (family/genus) if detailed mode
    if verbose and "otherResults" in data:
        other = data["otherResults"]

        if "genus" in other and other["genus"]:
            print(f"\n🌿 Top Genus Predictions:")
            for i, genus in enumerate(other["genus"][:5], 1):
                score = genus.get("score", 0) * 100
                name = genus.get("genus", {}).get("scientificNameWithoutAuthor", "N/A")
                print(f"   {i}. {name} ({score:.1f}%)")

        if "family" in other and other["family"]:
            print(f"\n🌳 Top Family Predictions:")
            for i, family in enumerate(other["family"][:5], 1):
                score = family.get("score", 0) * 100
                name = family.get("family", {}).get("scientificNameWithoutAuthor", "N/A")
                print(f"   {i}. {name} ({score:.1f}%)")

    # Display predicted organs
    if verbose and "predictedOrgans" in data:
        organs = data["predictedOrgans"]
        if organs:
            print(f"\n🔍 Detected Organs:")
            for organ in organs:
                img_name = organ.get("filename", "unknown")
                detected = organ.get("organ", "unknown")
                confidence = organ.get("score", 0) * 100
                print(f"   {img_name}: {detected} ({confidence:.1f}%)")


def main():
    parser = argparse.ArgumentParser(
        description="Identify plants using PlantNet API",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument("images", nargs="+", help="Image file(s) to identify (1-5 images, same plant)")

    parser.add_argument("-o", "--organs", nargs="*", choices=ORGANS,
                       help=f"Plant organ(s) per image: {', '.join(ORGANS)} (default: auto)")

    parser.add_argument("-p", "--project", default="all", metavar="PROJECT",
                       help=f"Project/flora database (default: all). See API docs for full list.")

    parser.add_argument("-r", "--include-related", action="store_true",
                       help="Include reference images in response")

    parser.add_argument("-n", "--no-reject", action="store_true",
                       help="Don't reject if top result isn't a plant")

    parser.add_argument("-l", "--limit", type=int, metavar="N",
                       help="Limit results to top N matches (≥1)")

    parser.add_argument("-d", "--detailed", action="store_true",
                       help="Include family/genus results (slower)")

    parser.add_argument("-g", "--lang", default="en", metavar="CODE",
                       help="Language code for common names (default: en)")

    parser.add_argument("-q", "--quiet", action="store_true",
                       help="Quiet mode - minimal output")

    args = parser.parse_args()

    # Validate inputs
    if len(args.images) == 0:
        parser.print_help()
        return 1

    if len(args.images) > 5:
        print("Error: Maximum 5 images per request")
        return 1

    # Check image files exist
    for img in args.images:
        if not os.path.exists(img):
            print(f"Error: Image file not found: {img}")
            return 1

    # Identify plants
    print(f"Identifying {len(args.images)} image(s) with PlantNet API...\n")

    results = identify_plant(
        image_files=args.images,
        organs=args.organs,
        project=args.project,
        include_related=args.include_related,
        no_reject=args.no_reject,
        nb_results=args.limit,
        detailed=args.detailed,
        lang=args.lang
    )

    # Log the identification attempt
    log_identification(
        prompt=f"Identification of {len(args.images)} image(s)",
        image_files=args.images,
        results=results,
        status=results["status"]
    )

    # Display results
    format_results(results, verbose=not args.quiet)

    return 0 if results["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
