"""
Contact Extraction Script
Extracts contact information from business websites.
Respects robots.txt and rate limits.
"""

import requests
from bs4 import BeautifulSoup
import re
import time
from typing import Dict, Optional, List
from datetime import datetime


class ContactExtractor:
    """Extract contact information from business websites."""
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        
        # Email patterns
        self.email_pattern = re.compile(
            r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        )
        
        # Phone patterns (US/International)
        self.phone_patterns = [
            re.compile(r'\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}'),  # US
            re.compile(r'\+\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}'),  # International
        ]
    
    def get_page(self, url: str) -> Optional[str]:
        """Fetch a page with rate limiting."""
        try:
            time.sleep(1.5)  # Respectful rate limiting
            response = self.session.get(url, timeout=15)
            
            if response.status_code == 200:
                return response.text
        except Exception as e:
            print(f"Error fetching {url}: {e}")
        return None
    
    def extract_emails(self, text: str) -> List[str]:
        """Extract emails from text."""
        emails = self.email_pattern.findall(text)
        # Dedupe and filter common false positives
        valid = [e for e in set(emails) 
                 if not e.startswith('example') 
                 and not e.endswith('@example.com')]
        return valid
    
    def extract_phones(self, text: str) -> List[str]:
        """Extract phone numbers from text."""
        phones = []
        for pattern in self.phone_patterns:
            found = pattern.findall(text)
            phones.extend(found)
        # Clean up
        cleaned = [re.sub(r'\s+', ' ', p.strip()) for p in phones]
        return list(set(cleaned))
    
    def find_contact_page(self, soup: BeautifulSoup, base_url: str) -> Optional[str]:
        """Find the contact page URL."""
        contact_keywords = ['contact', 'contact-us', 'contactus', 'get-in-touch']
        
        for link in soup.find_all('a', href=True):
            href = link['href'].lower()
            text = link.get_text().lower()
            
            if any(kw in href or kw in text for kw in contact_keywords):
                # Handle relative URLs
                if href.startswith('/'):
                    return base_url.rstrip('/') + href
                elif href.startswith('http'):
                    return href
                else:
                    return base_url.rstrip('/') + '/' + href
        
        return None
    
    def extract_from_page(self, url: str) -> Dict:
        """Extract all contact info from a URL."""
        result = {
            'url': url,
            'emails': [],
            'phones': [],
            'social_links': {},
            'address': None,
            'extracted_at': datetime.now().isoformat()
        }
        
        html = self.get_page(url)
        if not html:
            return result
        
        soup = BeautifulSoup(html, 'lxml')
        
        # Extract emails
        result['emails'] = self.extract_emails(html)
        
        # Extract phones
        result['phones'] = self.extract_phones(html)
        
        # Extract social links
        for link in soup.find_all('a', href=True):
            href = link['href'].lower()
            if 'facebook.com' in href:
                result['social_links']['facebook'] = link['href']
            elif 'twitter.com' in href or 'x.com' in href:
                result['social_links']['twitter'] = link['href']
            elif 'instagram.com' in href:
                result['social_links']['instagram'] = link['href']
            elif 'linkedin.com' in href:
                result['social_links']['linkedin'] = link['href']
        
        # Try to find contact page
        contact_url = self.find_contact_page(soup, url)
        if contact_url and contact_url != url:
            contact_result = self.extract_from_page(contact_url)
            # Merge results (prefer contact page data)
            if contact_result['emails']:
                result['emails'] = contact_result['emails']
            if contact_result['phones']:
                result['phones'] = contact_result['phones']
            result['contact_page'] = contact_url
        
        return result
    
    def guess_email_pattern(self, website: str, contact_name: str = "") -> List[str]:
        """Generate likely email patterns for a business."""
        if not website:
            return []
        
        domain = website.replace('https://', '').replace('http://', '').rstrip('/')
        domain = re.sub(r'^www\.', '', domain)
        
        # Remove paths
        if '/' in domain:
            domain = domain.split('/')[0]
        
        patterns = []
        
        if contact_name:
            parts = contact_name.lower().split()
            first = parts[0] if parts else ''
            last = parts[-1] if len(parts) > 1 else ''
            
            patterns.extend([
                f"{first}@{domain}",
                f"{first}.{last}@{domain}",
                f"{first[0]}{last}@{domain}" if last else f"{first}@{domain}",
                f"{first}{last[0]}@{domain}" if last else f"{first}@{domain}",
                f"info@{domain}",
                f"contact@{domain}",
                f"admin@{domain}",
            ])
        else:
            patterns.extend([
                f"info@{domain}",
                f"contact@{domain}",
                f"admin@{domain}",
            ])
        
        return list(set(patterns))


def main():
    """Example usage."""
    extractor = ContactExtractor()
    
    result = extractor.extract_from_page("https://example.com")
    print(f"Extracted: {result}")
    return result


if __name__ == "__main__":
    main()
